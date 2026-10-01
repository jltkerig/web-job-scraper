// Keeps every captured job, writes one jobs.json per site per day into
// web-job-scraper\searches\passive-mm-dd-yyyy\<site>\ in Firefox's downloads folder, and runs the capture health check.
"use strict";

const SITES = {
  linkedin: { name: "LinkedIn", parse: globalThis.LinkedInParse, api: "https://www.linkedin.com/voyager/api/*" },
};
const SAVE_EVERY_MS = 5 * 60 * 1000;
const KEEP_DAYS = 30;
const ROOT = "web-job-scraper";
const MAX_DEBUG_RESPONSES = 8;
const MAX_FLOWERS = 500;
const PET_DEFAULTS = { enabled: true, speed: "normal", sites: { linkedin: true } };
// Error codes shown in the panel (E7xxx; Job Finder's import uses E6xxx). Listed in the README.
const ERRORS = {
  save: "E7001", // the day's file could not be saved to the downloads folder
  broken: "E7002", // on a jobs page, but no jobs were captured
  debug: "E7003", // "Save page for fixing" did not work
  update: "E7004", // the update check could not reach the project's GitHub Pages site
  details: "E7005", // a job was open, but its details (description, location) could not be read
};

const state = {
  jobs: {}, // "site:job_id" -> record
  settings: { enabled: { linkedin: true } },
  dirty: new Set(), // "site|yyyy-mm-dd" files that need writing
  lastSave: {}, // site -> ISO time
  broken: {}, // site -> { url, since }
  errors: {}, // site -> { code, message, at } for the last failed save
  garden: [], // newest first: one flower per captured job, kept beyond the 30-day job store (see plant())
  noDetails: {}, // site -> { jobId, url, since, saved } when an open job's details could not be read
  autoSavedDay: {}, // site -> day a page copy was last saved automatically (at most one a day)
};
const tabCounts = new Map(); // tabId -> jobs received since the tab's last page view
const tabSites = new Map(); // tabId -> site
const recentResponses = new Map(); // tabId -> [{ url, text }] for "Save page for fixing"
let persistTimer = null;
const ready = load();

// ---------- dates ----------

function localDay(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function folderDate(day) {
  const [year, month, date] = day.split("-");
  return `${month}-${date}-${year}`;
}

function stamp(date = new Date()) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${folderDate(localDay(date))}-${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

// ---------- storage ----------

async function load() {
  const saved = await browser.storage.local.get(
    ["jobs", "settings", "dirty", "lastSave", "broken", "errors", "noDetails", "autoSavedDay", "garden"]);
  state.garden = saved.garden || [];
  state.errors = saved.errors || {};
  state.noDetails = saved.noDetails || {};
  state.autoSavedDay = saved.autoSavedDay || {};
  state.jobs = saved.jobs || {};
  state.settings = { ...state.settings, ...(saved.settings || {}) };
  state.settings.enabled = { linkedin: true, ...(state.settings.enabled || {}) };
  const pet = state.settings.pet || {};
  state.settings.pet = { ...PET_DEFAULTS, ...pet, sites: { ...PET_DEFAULTS.sites, ...(pet.sites || {}) } };
  state.dirty = new Set(saved.dirty || []);
  state.lastSave = saved.lastSave || {};
  state.broken = saved.broken || {};
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const [key, job] of Object.entries(state.jobs)) {
    if (Date.parse(job.last_seen) < cutoff) delete state.jobs[key];
  }
  updateBadge();
}

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 3000);
}

function persist() {
  clearTimeout(persistTimer);
  return browser.storage.local.set({
    jobs: state.jobs, settings: state.settings, dirty: [...state.dirty], lastSave: state.lastSave, broken: state.broken,
    errors: state.errors, noDetails: state.noDetails, autoSavedDay: state.autoSavedDay, garden: state.garden,
  });
}

// ---------- merging captured jobs ----------

const FIELDS = ["title", "company", "location", "salary", "work_arrangement", "posted", "description"];

// Newer non-empty values win; an opened job never goes back to "seen"; the first page kind that
// isn't "other" is kept, since it says where the job was found.
function merge(old, job, now) {
  const record = old ? { ...old } : { site: job.site, job_id: job.job_id, url: job.url, first_seen: now, closed: false };
  for (const field of FIELDS) {
    if (job[field]) record[field] = job[field];
    else if (record[field] === undefined) record[field] = "";
  }
  record.url = job.url || record.url;
  record.level = record.level === "opened" || job.level === "opened" ? "opened" : "seen";
  if (job.level === "opened") record.closed = Boolean(job.closed);
  record.applied = Boolean(record.applied || job.applied); // LinkedIn doesn't show "Applied" everywhere, so keep it
  if (!record.page_kind || (record.page_kind === "other" && job.page_kind !== "other")) record.page_kind = job.page_kind;
  record.last_seen = now;
  return record;
}

function sameContent(a, b) {
  const strip = (record) => JSON.stringify({ ...record, last_seen: undefined });
  return strip(a) === strip(b);
}

// ---------- garden ----------

// One flower per captured job, newest first. The garden keeps only what a flower needs, so it outlives the
// 30-day job store. A flower's stage follows the job: sprout (seen), bloom (opened), sparkle (applied), wilt (closed).
function plant(record) {
  const key = `${record.site}:${record.job_id}`;
  const flower = {
    key, site: record.site, title: record.title, company: record.company, salary: record.salary,
    url: record.url, level: record.level, applied: record.applied, closed: record.closed,
  };
  const at = state.garden.findIndex((item) => item.key === key);
  if (at >= 0) {
    state.garden[at] = { ...state.garden[at], ...flower };
    return false;
  }
  state.garden.unshift({ ...flower, planted: new Date().toISOString() });
  if (state.garden.length > MAX_FLOWERS) state.garden.length = MAX_FLOWERS;
  return true;
}

// Saves captured jobs. Returns how many were new (never captured before), which makes the fox pounce.
function addJobs(site, jobs, tabId) {
  if (!state.settings.enabled[site] || !jobs.length) return 0;
  const now = new Date().toISOString();
  const today = localDay();
  let changed = false;
  let added = 0;
  for (const job of jobs) {
    if (!job || job.site !== site || !job.job_id) continue;
    const key = `${site}:${job.job_id}`;
    const old = state.jobs[key];
    const record = merge(old, job, now);
    const sameDay = old && localDay(new Date(old.last_seen)) === today;
    state.jobs[key] = record;
    if (!old || !sameDay || !sameContent(old, record)) {
      state.dirty.add(`${site}|${today}`);
      changed = true;
      if (record.title && plant(record)) added += 1;
    }
  }
  if (tabId !== undefined && tabId >= 0) tabCounts.set(tabId, (tabCounts.get(tabId) || 0) + jobs.length);
  if (state.broken[site]) {
    delete state.broken[site];
    changed = true;
  }
  if (state.noDetails[site] && jobs.some((job) => job.level === "opened")) {
    delete state.noDetails[site]; // a job's details were read again, so the reading works
    changed = true;
  }
  if (changed) {
    persistSoon();
    updateBadge();
  }
  // The fox on that tab pounces, and its strip shows the new flowers.
  if (changed && tabId !== undefined && tabId >= 0) {
    browser.tabs.sendMessage(tabId, { type: "pet-update", added, ...petState() }).catch(() => {});
  }
  return added;
}

function petState() {
  return { pet: state.settings.pet, garden: state.garden.slice(0, 7) };
}

// ---------- writing files ----------

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  return new Promise((resolve, reject) => {
    let id = null;
    const finish = (error) => {
      browser.downloads.onChanged.removeListener(listener);
      URL.revokeObjectURL(url);
      if (id !== null) browser.downloads.erase({ id }).catch(() => {}); // keep Firefox's download list clear
      error ? reject(error) : resolve();
    };
    const listener = (delta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === "complete") finish();
      else if (delta.state.current === "interrupted") finish(new Error(`Download of ${filename} was interrupted`));
    };
    browser.downloads.onChanged.addListener(listener);
    browser.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false })
      .then((downloadId) => { id = downloadId; })
      .catch(finish);
  });
}

async function writeDay(site, day) {
  const jobs = Object.values(state.jobs)
    .filter((job) => job.site === site && localDay(new Date(job.last_seen)) === day)
    .sort((a, b) => a.first_seen.localeCompare(b.first_seen));
  const body = {
    source: "web-job-scraper",
    extension_version: browser.runtime.getManifest().version,
    site,
    day,
    written_at: new Date().toISOString(),
    jobs,
  };
  const filename = `${ROOT}/searches/passive-${folderDate(day)}/${site}/jobs.json`;
  await download(filename, JSON.stringify(body, null, 2), "application/json");
}

let flushing = false;

// Writes changed day files. Without force, a site is written at most every 5 minutes.
async function flush(force = false) {
  await ready;
  if (flushing) return;
  flushing = true;
  try {
    for (const key of [...state.dirty]) {
      const [site, day] = key.split("|");
      const last = Date.parse(state.lastSave[site] || 0) || 0;
      if (!force && Date.now() - last < SAVE_EVERY_MS) continue;
      try {
        await writeDay(site, day);
        state.dirty.delete(key);
        state.lastSave[site] = new Date().toISOString();
        delete state.errors[site];
      } catch (error) {
        // The jobs stay in the extension and the file is tried again at the next save.
        state.errors[site] = {
          code: ERRORS.save,
          message: `Could not save today's ${SITES[site].name} file to your downloads folder: ${error.message || error}`,
          at: new Date().toISOString(),
        };
      }
    }
    await persist();
    updateBadge();
  } finally {
    flushing = false;
  }
}

// ---------- network capture ----------

function responseText(chunks) {
  const decoder = new TextDecoder("utf-8");
  return chunks.map((chunk, index) => decoder.decode(chunk, { stream: index < chunks.length - 1 })).join("");
}

function rememberResponse(tabId, url, text) {
  if (text.length > 1_000_000) return;
  const list = recentResponses.get(tabId) || [];
  list.push({ url, text });
  while (list.length > MAX_DEBUG_RESPONSES) list.shift();
  recentResponses.set(tabId, list);
}

for (const [site, info] of Object.entries(SITES)) {
  browser.webRequest.onBeforeRequest.addListener((details) => {
    // Only job pages, and only while capture is on for the site. Everything is passed through unchanged.
    if (!state.settings.enabled[site] || !String(details.documentUrl || "").includes("/jobs")) return undefined;
    const filter = browser.webRequest.filterResponseData(details.requestId);
    const chunks = [];
    filter.ondata = (event) => {
      chunks.push(event.data);
      filter.write(event.data);
    };
    filter.onstop = () => {
      filter.close();
      const text = responseText(chunks);
      if (!text.includes("obPosting")) return;
      rememberResponse(details.tabId, details.url, text);
      try {
        addJobs(site, info.parse.fromVoyager(JSON.parse(text), details.documentUrl), details.tabId);
      } catch (error) {
        // Not JSON, or not job data.
      }
    };
    filter.onerror = () => {};
    return undefined;
  }, { urls: [info.api], types: ["xmlhttprequest"] }, ["blocking"]);
}

// ---------- health check, badge ----------

function updateBadge() {
  const problems = [
    ...Object.keys(state.errors).map((site) => `[${state.errors[site].code}] ${SITES[site].name} file not saved`),
    ...Object.keys(state.noDetails).map((site) => `[${ERRORS.details}] ${SITES[site].name} job details not read`),
    ...Object.keys(state.broken).map((site) => `[${ERRORS.broken}] ${SITES[site].name} capture may be broken`),
  ];
  if (problems.length) {
    browser.browserAction.setBadgeText({ text: "!" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#e8730c" });
    browser.browserAction.setTitle({ title: `Job Scraper: ${problems.join("; ")}` });
    return;
  }
  const today = localDay();
  const fresh = Object.values(state.jobs).filter((job) => localDay(new Date(job.first_seen)) === today).length;
  browser.browserAction.setBadgeText({ text: fresh ? String(fresh) : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#2f6fd6" });
  browser.browserAction.setTitle({ title: `Job Scraper: ${fresh} new job${fresh === 1 ? "" : "s"} today` });
}

async function pageSettled(site, message, tabId) {
  if (!message.expectsJobs || !state.settings.enabled[site]) return;
  if (message.found === 0 && (tabCounts.get(tabId) || 0) === 0) {
    state.broken[site] = { url: message.pageUrl, since: new Date().toISOString() };
    persistSoon();
    updateBadge();
    return;
  }
  // A job is open (its own page or the details pane): its full details should have been read by now.
  const job = message.detailJobId && state.jobs[`${site}:${message.detailJobId}`];
  if (!message.detailJobId || (job && job.level === "opened")) return;
  const today = localDay();
  const problem = { jobId: message.detailJobId, url: message.pageUrl, since: new Date().toISOString(), saved: null };
  // One page copy a day is enough to fix the reading; it's saved without asking so nothing has to be clicked.
  if (state.autoSavedDay[site] !== today && tabId !== undefined) {
    try {
      problem.saved = await saveDebug(site, tabId);
      state.autoSavedDay[site] = today;
    } catch (error) {
      problem.saved = null;
    }
  } else if (state.noDetails[site]) {
    problem.saved = state.noDetails[site].saved;
  }
  state.noDetails[site] = problem;
  persistSoon();
  updateBadge();
}

// ---------- popup ----------

function popupState() {
  const today = localDay();
  const sites = {};
  for (const [site, info] of Object.entries(SITES)) {
    const jobs = Object.values(state.jobs).filter((job) => job.site === site);
    const todays = jobs.filter((job) => localDay(new Date(job.last_seen)) === today);
    sites[site] = {
      name: info.name,
      enabled: Boolean(state.settings.enabled[site]),
      seen: todays.length,
      opened: todays.filter((job) => job.level === "opened").length,
      fresh: jobs.filter((job) => localDay(new Date(job.first_seen)) === today).length,
      lastSave: state.lastSave[site] || null,
      unsaved: [...state.dirty].some((key) => key.startsWith(`${site}|`)),
      broken: state.broken[site] ? { ...state.broken[site], code: ERRORS.broken } : null,
      error: state.errors[site] || null,
      noDetails: state.noDetails[site] ? { ...state.noDetails[site], code: ERRORS.details } : null,
    };
  }
  const needsLook = Object.values(state.jobs)
    .filter((job) => !job.location && job.level !== "opened" && !job.closed && !job.applied)
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen));
  return {
    sites,
    needsLookTotal: needsLook.length,
    needsLook: needsLook.slice(0, 30).map(({ site, title, company, url }) => ({ site, title, company, url })),
    ...petState(),
  };
}

// Saves a LinkedIn tab's page and recent background data to web-job-scraper\debug\ in the downloads folder (the active tab
// unless one is given). Returns the folder.
async function saveDebug(site, tabId) {
  const fail = (message) => new Error(`[${ERRORS.debug}] ${message}`);
  const tab = tabId !== undefined ? { id: tabId } : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  let page = null;
  try {
    page = tab ? await browser.tabs.sendMessage(tab.id, { type: "get-page-html" }) : null;
  } catch (error) {
    page = null; // the tab isn't a page the extension runs on
  }
  if (!page) throw fail(`Open the ${SITES[site].name} jobs page that had the problem, then try again.`);
  const folder = `${ROOT}/debug/${site}-${stamp()}`;
  try {
    await download(`${folder}/page.html`, page.html, "text/html");
    const responses = recentResponses.get(tab.id) || [];
    await download(`${folder}/responses.json`, JSON.stringify({ url: page.url, responses }, null, 2), "application/json");
  } catch (error) {
    throw fail(`Could not save the page to your downloads folder: ${error.message || error}`);
  }
  return folder;
}

// ---------- updates ----------

// The newest build is listed on the project's GitHub Pages site, at the manifest's update_url (the same list the gear
// menu in about:addons reads; release.ps1 publishes it). Firefox only installs an add-on from something the user
// clicks on a web page (opening the .xpi from here shows a blank tab), so the site's install page is opened instead;
// its Install button makes Firefox ask "Add Web Job Scraper?".
function newer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function checkForUpdate() {
  const manifest = browser.runtime.getManifest();
  const current = manifest.version;
  let update = null;
  try {
    const response = await fetch(manifest.browser_specific_settings.gecko.update_url, { cache: "no-store" });
    const data = await response.json();
    const updates = (((data.addons || {})[manifest.browser_specific_settings.gecko.id] || {}).updates) || [];
    update = updates.filter((item) => item.version && item.update_link).sort((a, b) => (newer(a.version, b.version) ? -1 : 1))[0] || null;
  } catch (error) {
    return { status: "error", message: `[${ERRORS.update}] Could not check for updates. Are you online?` };
  }
  if (!update || !newer(update.version, current)) return { status: "current", message: `Up to date (v${current}).` };
  await flush(true); // today's jobs are saved before the new version takes over
  await browser.tabs.create({ url: new URL("./", manifest.browser_specific_settings.gecko.update_url).href });
  return { status: "update", message: `v${update.version} is ready: click Install on the page that opened.` };
}

browser.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender.tab ? sender.tab.id : undefined;
  return ready.then(async () => {
    switch (message && message.type) {
      case "jobs":
        if (tabId !== undefined) tabSites.set(tabId, message.site);
        addJobs(message.site, message.jobs || [], tabId);
        return true;
      case "page-view":
        if (tabId !== undefined) {
          tabSites.set(tabId, message.site);
          tabCounts.set(tabId, 0);
        }
        return true;
      case "page-settled":
        await pageSettled(message.site, message, tabId);
        return true;
      case "popup-state":
        return popupState();
      case "pet-state":
        return petState();
      case "set-pet": {
        const pet = state.settings.pet;
        if (typeof message.enabled === "boolean") pet.enabled = message.enabled;
        if (["calm", "normal", "playful"].includes(message.speed)) pet.speed = message.speed;
        await persist();
        // Every open job-site tab updates its fox straight away.
        for (const [id] of tabSites) browser.tabs.sendMessage(id, { type: "pet-update", added: 0, ...petState() }).catch(() => {});
        return popupState();
      }
      case "set-enabled":
        state.settings.enabled[message.site] = Boolean(message.enabled);
        if (!message.enabled) delete state.broken[message.site];
        await persist();
        updateBadge();
        return popupState();
      case "save-now":
        await flush(true);
        return popupState();
      case "check-update":
        return checkForUpdate();
      case "save-debug":
        return { folder: await saveDebug(message.site) };
      case "clear-warning":
        delete state.broken[message.site];
        delete state.noDetails[message.site];
        await persist();
        updateBadge();
        return popupState();
      default:
        return undefined;
    }
  });
});

// A site tab closing saves right away, so a session's jobs aren't left waiting.
browser.tabs.onRemoved.addListener((tabId) => {
  const site = tabSites.get(tabId);
  tabSites.delete(tabId);
  tabCounts.delete(tabId);
  recentResponses.delete(tabId);
  if (site) flush(true);
});

browser.alarms.create("flush", { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flush") {
    flush(false);
    updateBadge(); // rolls the "new today" count over at midnight
  }
});

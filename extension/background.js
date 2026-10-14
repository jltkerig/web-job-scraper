// Keeps every captured job, writes a new jobs.json for each save (only the jobs that are new or changed since the
// last one) into web-job-scraper\searches\passive-mm-dd-yyyy-hh.mm.ss.mmm\<site>\ in Firefox's downloads folder, and
// runs the capture health check.
"use strict";

// Each site: its reader, the background data to read (LinkedIn only), and the hosts it lives on.
const SITES = {
  linkedin: { name: "LinkedIn", parse: globalThis.LinkedInParse, api: "https://www.linkedin.com/voyager/api/*",
    hosts: ["www.linkedin.com"] },
  // The Maryland Workforce Exchange allows no automated visitors, so only pages you open are read.
  mwe: { name: "Maryland Workforce Exchange", parse: globalThis.MweParse, api: null,
    hosts: ["mwejobs.maryland.gov", "www.mwejobs.maryland.gov"] },
  // Not read yet: on this one only "Save this page for fixing" works, to collect their page layouts (sites/sample-only.js).
  indeed: { name: "Indeed", parse: globalThis.SampleParse, api: null, sampleOnly: true,
    hosts: ["www.indeed.com", "indeed.com"] },
  // Like the Maryland exchange, USAJOBS blocks automated visitors, so only pages you open are read.
  usajobs: { name: "USAJOBS", parse: globalThis.UsajobsParse, api: null,
    hosts: ["www.usajobs.gov", "usajobs.gov"] },
};

function siteForUrl(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (error) {
    return null;
  }
  return Object.keys(SITES).find((site) => SITES[site].hosts.includes(host)) || null;
}
const SAVE_EVERY_MS = 5 * 60 * 1000;
const KEEP_DAYS = 30;
const ROOT = "web-job-scraper";
const MAX_DEBUG_RESPONSES = 8;
const PET_DEFAULTS = { enabled: true, speed: "normal", sites: { linkedin: true } };
// Error codes shown in the panel (E7xxx; Job Finder's import uses E6xxx). Listed in the README.
const ERRORS = {
  save: "E7001", // the day's file could not be saved to the downloads folder
  broken: "E7002", // on a jobs page, but no jobs were captured
  debug: "E7003", // "Save page for fixing" did not work
  update: "E7004", // the update check could not reach the project's GitHub Pages site
  details: "E7005", // a job was open, but its details (description, location) could not be read
  signIn: "E7006", // a scheduled run stopped: LinkedIn asked you to sign in
  securityCheck: "E7007", // a scheduled run stopped: LinkedIn showed a security check (no more runs that day)
  runTabClosed: "E7008", // a scheduled run stopped: its tab was closed
  runFailed: "E7009", // a scheduled run stopped for another reason
};

const state = {
  jobs: {}, // "site:job_id" -> record
  settings: { enabled: { linkedin: true, mwe: true } },
  dirty: new Set(), // "site|yyyy-mm-dd" files that need writing
  lastSave: {}, // site -> ISO time
  lastWritten: {}, // "site|yyyy-mm-dd" -> ISO time of the last file written: the next file holds what changed after it
  broken: {}, // site -> { url, since }
  errors: {}, // site -> { code, message, at } for the last failed save
  noDetails: {}, // site -> { jobId, url, since, saved } when an open job's details could not be read
  autoSavedDay: {}, // site -> day a page copy was last saved automatically (at most one a day)
  runs: [], // scheduled LinkedIn runs and their result tags (runs.js)
  securityCheckDay: null, // the day LinkedIn last showed a security check during a run: no more runs that day
  runAlert: null, // { code, message } of the last stopped run, until dismissed
  badgeClearedAt: null, // ISO time "Clear count" was last clicked; the icon's number counts jobs found after it
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
    ["jobs", "settings", "dirty", "lastSave", "lastWritten", "broken", "errors", "noDetails", "autoSavedDay", "runs", "securityCheckDay",
      "runAlert", "badgeClearedAt"]);
  state.badgeClearedAt = saved.badgeClearedAt || null;
  state.errors = saved.errors || {};
  state.runs = saved.runs || [];
  state.securityCheckDay = saved.securityCheckDay || null;
  state.runAlert = saved.runAlert || null;
  browser.storage.local.remove(["garden", "petPosition"]).catch(() => {}); // from v0.2.x, no longer used
  state.noDetails = saved.noDetails || {};
  state.autoSavedDay = saved.autoSavedDay || {};
  state.jobs = saved.jobs || {};
  state.settings = { ...state.settings, ...(saved.settings || {}) };
  state.settings.enabled = { linkedin: true, mwe: true, ...(state.settings.enabled || {}) };
  const pet = state.settings.pet || {};
  state.settings.pet = { ...PET_DEFAULTS, ...pet, sites: { ...PET_DEFAULTS.sites, ...(pet.sites || {}) } };
  state.dirty = new Set(saved.dirty || []);
  state.lastSave = saved.lastSave || {};
  state.lastWritten = saved.lastWritten || {};
  state.broken = saved.broken || {};
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const [key, job] of Object.entries(state.jobs)) {
    if (Date.parse(job.last_seen) < cutoff) delete state.jobs[key];
    else if (!job.changed_at) job.changed_at = job.last_seen; // saved before files held only what changed
  }
  catchUpRuns(); // runs.js: runs due while Firefox was closed
  updateBadge();
}

function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persist, 3000);
}

function persist() {
  clearTimeout(persistTimer);
  return browser.storage.local.set({
    jobs: state.jobs, settings: state.settings, dirty: [...state.dirty], lastSave: state.lastSave, lastWritten: state.lastWritten, broken: state.broken,
    errors: state.errors, noDetails: state.noDetails, autoSavedDay: state.autoSavedDay, runs: state.runs,
    securityCheckDay: state.securityCheckDay, runAlert: state.runAlert, badgeClearedAt: state.badgeClearedAt,
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
  else if (job.closed) record.closed = true; // a list card that says "No longer accepting applications"
  record.applied = Boolean(record.applied || job.applied); // LinkedIn doesn't show "Applied" everywhere, so keep it
  if (!record.page_kind || (record.page_kind === "other" && job.page_kind !== "other")) record.page_kind = job.page_kind;
  record.last_seen = now;
  return record;
}

function sameContent(a, b) {
  const strip = (record) => JSON.stringify({ ...record, last_seen: undefined, changed_at: undefined });
  return strip(a) === strip(b);
}

// Saves captured jobs. Returns how many were new (never captured before), which makes the fox pounce.
function addJobs(site, jobs, tabId) {
  if (!state.settings.enabled[site] || !jobs.length) return 0;
  const now = new Date().toISOString();
  const today = localDay();
  let changed = false;
  let added = 0;
  const keys = [];
  const freshKeys = [];
  for (const job of jobs) {
    if (!job || job.site !== site || !job.job_id) continue;
    if (globalThis.LocationFilter && globalThis.LocationFilter.outsideUS(job.location)) continue; // placed outside the U.S.
    const key = `${site}:${job.job_id}`;
    const old = state.jobs[key];
    const record = merge(old, job, now);
    const sameDay = old && localDay(new Date(old.last_seen)) === today;
    state.jobs[key] = record;
    keys.push(key);
    if (!old && record.title) freshKeys.push(key);
    if (!old || !sameDay || !sameContent(old, record)) {
      record.changed_at = now;
      state.dirty.add(`${site}|${today}`);
      changed = true;
      if (!old && record.title) added += 1;
    }
  }
  runSawJobs(tabId, keys, freshKeys); // runs.js: counts toward a scheduled run's result
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
  // The fox on that tab pounces for new jobs, and its garden gains or loses flowers.
  if (changed && tabId !== undefined && tabId >= 0) {
    browser.tabs.sendMessage(tabId, { type: "pet-update", added, ...petState(tabId) }).catch(() => {});
  }
  return added;
}

// ---------- garden ----------

// The garden: jobs the extension has spotted but not collected yet (only their card was read), newest first.
// A job leaves the garden once its full details are collected (you opened it) or LinkedIn says it's closed.
// The garden starts empty each time Firefox starts: only jobs seen since then grow flowers (one seen in an
// earlier session gets a flower again when it turns up in a list).
const MAX_FLOWERS = 120; // more than any screen shows
const GARDEN_SINCE = new Date().toISOString();
function waitingJobs() {
  return Object.values(state.jobs)
    .filter((job) => job.title && job.level !== "opened" && !job.closed && job.last_seen >= GARDEN_SINCE)
    .sort((a, b) => b.first_seen.localeCompare(a.first_seen))
    .slice(0, MAX_FLOWERS)
    .map(({ site, job_id: jobId, title, url }) => ({ key: `${site}:${jobId}`, title, url }));
}

// The fox never appears in a scheduled run's tab: nothing is added to pages the extension opens by itself.
function petState(tabId) {
  const pet = isRunTab(tabId) ? { ...state.settings.pet, enabled: false } : state.settings.pet;
  return { pet, garden: waitingJobs() };
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

// Writes one new file holding the day's jobs that are new or changed since the last file, so Job Finder imports
// each scrape once and a file is never rewritten. Returns false when nothing changed.
async function writeDay(site, day) {
  const startedAt = new Date();
  const since = state.lastWritten[`${site}|${day}`] || state.lastSave[site] || "";
  const jobs = Object.values(state.jobs)
    .filter((job) => job.site === site && localDay(new Date(job.last_seen)) === day && job.changed_at >= since)
    .map(({ changed_at: changedAt, ...job }) => job)
    .sort((a, b) => a.first_seen.localeCompare(b.first_seen));
  if (!jobs.length) return false;
  const body = {
    source: "web-job-scraper",
    extension_version: browser.runtime.getManifest().version,
    site,
    day,
    written_at: startedAt.toISOString(),
    jobs,
  };
  // Down to the millisecond, so two saves never share a folder and one file can't overwrite another.
  const time = [startedAt.getHours(), startedAt.getMinutes(), startedAt.getSeconds(), startedAt.getMilliseconds()]
    .map((part, index) => String(part).padStart(index === 3 ? 3 : 2, "0")).join(".");
  const filename = `${ROOT}/searches/passive-${folderDate(day)}-${time}/${site}/jobs.json`;
  await download(filename, JSON.stringify(body, null, 2), "application/json");
  state.lastWritten[`${site}|${day}`] = startedAt.toISOString();
  return true;
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
        const wrote = await writeDay(site, day);
        state.dirty.delete(key);
        if (wrote) state.lastSave[site] = new Date().toISOString();
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
  if (!info.api) continue; // only LinkedIn's background data is read
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
  if (state.runAlert) {
    // A stopped scheduled run (sign-in or security check) shows a red ! until dismissed in the panel.
    browser.browserAction.setBadgeText({ text: "!" });
    browser.browserAction.setBadgeBackgroundColor({ color: "#c62828" });
    browser.browserAction.setTitle({ title: `Job Scraper: [${state.runAlert.code}] ${state.runAlert.message}` });
    return;
  }
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
  // New today, and found since "Clear count" was last clicked.
  const cleared = state.badgeClearedAt || "";
  const fresh = Object.values(state.jobs)
    .filter((job) => localDay(new Date(job.first_seen)) === today && job.first_seen > cleared).length;
  browser.browserAction.setBadgeText({ text: fresh ? String(fresh) : "" });
  browser.browserAction.setBadgeBackgroundColor({ color: "#2f6fd6" });
  const since = cleared && localDay(new Date(cleared)) === today ? " since you cleared the count" : " today";
  browser.browserAction.setTitle({ title: `Job Scraper: ${fresh} new job${fresh === 1 ? "" : "s"}${since}` });
}

// Saves a copy of the open page for fixing, without asking (turn it off in the panel). At most one copy per site and kind
// of page a day (the first part of the address: /jobs, /viewjob, /search ...), and 12 a day in all, so the downloads
// folder doesn't fill up. Used when LinkedIn capture finds nothing, and on Indeed and USAJOBS (sample-only sites).
async function autoSample(site, tabId, pageUrl) {
  if (state.settings.autoSample === false || tabId === undefined || !SITES[site]) return;
  const today = localDay();
  let kind = "page";
  try {
    kind = new URL(pageUrl).pathname.split("/").filter(Boolean)[0] || "home";
  } catch (error) {
    // keep the generic kind
  }
  const key = `sample:${site}:${kind}`;
  const doneToday = Object.entries(state.autoSavedDay).filter(([name, day]) => name.startsWith("sample:") && day === today).length;
  if (state.autoSavedDay[key] === today || doneToday >= 12) return;
  try {
    await saveDebug(site, tabId);
    state.autoSavedDay[key] = today;
    persistSoon();
  } catch (error) {
    // Not saved this time; the next page of that kind tries again.
  }
}

async function pageSettled(site, message, tabId) {
  if (site === "sample") { // Indeed and USAJOBS: nothing is read there yet, only sample pages are kept
    const real = siteForUrl(message.pageUrl);
    if (real) await autoSample(real, tabId, message.pageUrl);
    return;
  }
  if (!message.expectsJobs || !state.settings.enabled[site]) return;
  if (message.found === 0 && (tabCounts.get(tabId) || 0) === 0) {
    state.broken[site] = { url: message.pageUrl, since: new Date().toISOString() };
    persistSoon();
    updateBadge();
    await autoSample(site, tabId, message.pageUrl);
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
    if (info.sampleOnly) continue; // nothing is captured there, so the panel doesn't list it
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
    runs: runsForPopup(),
    runAlert: state.runAlert,
    autoSample: state.settings.autoSample !== false,
  };
}

// Saves a LinkedIn tab's page and recent background data to web-job-scraper\debug\ in the downloads folder (the active tab
// unless one is given). Returns the folder.
async function saveDebug(site, tabId) {
  const fail = (message) => new Error(`[${ERRORS.debug}] ${message}`);
  const tab = tabId !== undefined ? { id: tabId } : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  // From the panel's button: the site is whichever job site the open tab is on.
  site = site || (tab && tab.url && siteForUrl(tab.url));
  if (!site) throw fail("Open a LinkedIn, Maryland Workforce Exchange, Indeed or USAJOBS jobs page, then try again.");
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
      case "set-auto-sample":
        state.settings.autoSample = Boolean(message.enabled);
        await persist();
        return popupState();
      case "page-view":
        if (message.site === "sample") return true; // nothing is captured on Indeed or USAJOBS yet
        if (tabId !== undefined) {
          tabSites.set(tabId, message.site);
          tabCounts.set(tabId, 0);
        }
        return true;
      case "page-settled":
        await pageSettled(message.site, message, tabId);
        return true;
      case "distances":
        return distancesFor(message.places);
      case "load-profile": // profile/profile.html: a file exported from Job Finder
        return loadProfileFile(message.profile);
      case "fit-profile-now": { // the LinkedIn page has no profile (or none with titles): say what is saved
        const saved = await browser.storage.local.get(["fitProfile", "fitProfileError"]);
        return { titles: ((saved.fitProfile && saved.fitProfile.titles) || []).length,
          error: saved.fitProfile ? "" : "load your Job Finder profile (extension button > Load profile)." };
      }
      case "popup-state":
        return popupState();
      case "pet-state":
        return petState(tabId);
      case "add-run":
        addRun(message.when);
        await persist();
        return popupState();
      case "remove-run":
        removeRun(message.id);
        await persist();
        return popupState();
      case "run-now": {
        const run = addRun(new Date().toISOString());
        browser.alarms.clear(`run:${run.id}`);
        startRun(run.id); // runs on its own; the panel shows its tag
        await persist();
        return popupState();
      }
      case "clear-run-alert":
        state.runAlert = null;
        await persist();
        updateBadge();
        return popupState();
      case "set-pet": {
        const pet = state.settings.pet;
        if (typeof message.enabled === "boolean") pet.enabled = message.enabled;
        if (["calm", "normal", "playful"].includes(message.speed)) pet.speed = message.speed;
        await persist();
        // Every open job-site tab updates its fox straight away.
        for (const [id] of tabSites) browser.tabs.sendMessage(id, { type: "pet-update", added: 0, ...petState(id) }).catch(() => {});
        return popupState();
      }
      case "set-enabled":
        state.settings.enabled[message.site] = Boolean(message.enabled);
        if (!message.enabled) delete state.broken[message.site];
        await persist();
        updateBadge();
        return popupState();
      case "clear-badge":
        state.badgeClearedAt = new Date().toISOString();
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
  runTabClosed(tabId); // runs.js: closing a run's tab stops the run
  const site = tabSites.get(tabId);
  tabSites.delete(tabId);
  tabCounts.delete(tabId);
  recentResponses.delete(tabId);
  if (site) flush(true);
});

// Your Job Finder profile (titles, skills, work preferences, blocked companies, home) for marking LinkedIn jobs that
// may fit (content/fit-marks.js). The extension works on its own: you export the profile from Job Finder's Dashboard
// ("Export for Web Job Scraper") and load the file here (popup > Load profile, profile/profile.html). Nothing is read
// from Job Finder, on this computer or the web.
async function saveFitProfile(profile) {
  distanceCache.clear(); // the home may have changed
  await browser.storage.local.set({ fitProfile: profile, fitProfileAt: new Date().toISOString(), fitProfileError: "", distanceError: "" });
}

// A profile file from Job Finder: checked, then kept. Returns { ok, titles, skills } or { ok: false, error }.
async function loadProfileFile(profile) {
  if (!profile || profile.source !== "job-finder" || profile.kind !== "fit-profile" || !Array.isArray(profile.titles)) {
    return { ok: false, error: "That isn't a Job Finder profile file. On Job Finder's Dashboard, click Export for Web Job Scraper." };
  }
  await saveFitProfile(profile);
  return { ok: true, titles: profile.titles.length, skills: (profile.skills || []).length };
}

// Estimated distance and 6 a.m. drive time from home to each job's town, the same estimate as Job Finder's Dashboard
// (travel.py / places.php): straight-line miles from the U.S. Census places table bundled in data/, times 1.3 for
// roads, at slower speeds near home. Nothing is looked up online.
const distanceCache = new Map(); // place -> { miles, minutes, text } or null
let placeIndex = null;
const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };
// States next to each other, so places near home come first ("Lancaster" -> Lancaster, PA for someone in MD).
const NEIGHBORS = { MD: ["DE", "PA", "VA", "WV", "DC"], DE: ["MD", "PA", "NJ"], PA: ["MD", "DE", "NJ", "NY", "OH", "WV"],
  VA: ["MD", "DC", "WV", "KY", "TN", "NC"], DC: ["MD", "VA"], NJ: ["NY", "PA", "DE"], WV: ["MD", "PA", "OH", "KY", "VA"],
  NY: ["NJ", "PA", "CT", "MA", "VT"] };
const DRIVE_SPEEDS = [[3, 20], [10, 30], [25, 42], [60, 52], [1e9, 58]]; // [road miles up to, mph at 6 a.m.]

function placeKey(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stateCode(text) {
  const clean = String(text || "").trim();
  if (STATE_NAMES[clean.toUpperCase()]) return clean.toUpperCase();
  return Object.keys(STATE_NAMES).find((code) => STATE_NAMES[code].toLowerCase() === clean.toLowerCase()) || "";
}

async function places() {
  if (!placeIndex) placeIndex = await (await fetch(browser.runtime.getURL("data/us-places.json"))).json();
  return placeIndex;
}

// [lat, lon] for "Harrisburg, PA", "Baltimore, Maryland, United States" or "Baltimore Metropolitan Area".
function placePoint(index, text, homeState) {
  const parts = String(text || "").replace(/\([^)]*\)/g, " ").split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const candidates = index[placeKey(parts[0].replace(/\b(?:greater|metropolitan|metro|area|region)\b/gi, " "))];
  if (!candidates) return null;
  const state = parts[1] ? stateCode(parts[1]) : "";
  if (state) {
    const match = candidates.find((c) => c[0] === state);
    return match ? [match[2], match[3]] : null;
  }
  const home = String(homeState || "").trim().slice(0, 2).toUpperCase();
  const near = home ? [home, ...(NEIGHBORS[home] || [])] : [];
  const best = [...candidates].sort((a, b) => (near.includes(b[0]) - near.includes(a[0])) || (b[1] - a[1]))[0];
  return [best[2], best[3]];
}

function milesBetween([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  const h = Math.sin((lat2 - lat1) * rad / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function driveMinutes(straight) {
  const road = straight * 1.3;
  let minutes = 0, done = 0;
  for (const [limit, mph] of DRIVE_SPEEDS) {
    const stretch = Math.min(road, limit) - done;
    if (stretch > 0) { minutes += stretch / mph * 60; done += stretch; }
    if (done >= road) break;
  }
  return minutes;
}

// { miles, minutes, text: "12 mi · ~20 min" } or null when home or the place isn't known.
function describeTrip(home, point) {
  if (!home || !point) return null;
  const straight = milesBetween(home, point);
  const minutes = driveMinutes(straight);
  const shown = minutes >= 3 ? Math.max(5, Math.round(minutes / 5) * 5) : Math.max(1, Math.round(minutes));
  const miles = Math.round(straight);
  const lasts = shown < 120 ? `~${shown} min` : `~${Math.round(shown / 60)} hr`;
  return { miles, minutes: shown, text: miles ? `${miles.toLocaleString("en-US")} mi · ${lasts}` : `under 1 mi · ${lasts}` };
}

async function distancesFor(wantedPlaces) {
  const wanted = [...new Set((wantedPlaces || []).map(String))].slice(0, 100);
  const { fitProfile } = await browser.storage.local.get("fitProfile");
  const home = fitProfile && fitProfile.home && fitProfile.home.lat != null ? [fitProfile.home.lat, fitProfile.home.lon] : null;
  if (!home) {
    browser.storage.local.set({ distanceError: "Distances need your Home ZIP: add it on Job Finder's Dashboard, export again and load the file." }).catch(() => {});
    return { places: {}, error: "no home" };
  }
  try {
    const index = await places();
    for (const place of wanted) {
      if (!distanceCache.has(place)) distanceCache.set(place, describeTrip(home, placePoint(index, place, fitProfile.home.state)));
    }
  } catch (error) {
    return { places: {}, error: String(error.message || error) };
  }
  return { places: Object.fromEntries(wanted.map((place) => [place, distanceCache.get(place)])) };
}

browser.alarms.create("flush", { periodInMinutes: 1 });
browser.alarms.clear("fit-profile"); // older versions read Job Finder every few minutes
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flush") {
    flush(false);
    updateBadge(); // rolls the "new today" count over at midnight
  } else if (alarm.name.startsWith("run:")) {
    startRun(alarm.name.slice(4)); // runs.js: a scheduled run's time has come
  }
});

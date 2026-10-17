// Scheduled LinkedIn runs: at a date and time you pick, Firefox opens LinkedIn's recommended-jobs pages in a
// background tab, collects the jobs the usual way (the page's own data, read by content/capture.js and
// background.js), opens up to 10 new jobs for their details at a human pace, and closes the tab.
// Each run gets a result tag: Scheduled, Running, Done, Stopped (with an error code) or Missed.
// It stops at once on a sign-in page or any security check, and no further run happens that day.
// Loaded after background.js and shares its globals (state, ERRORS, persist, updateBadge, localDay).
"use strict";

const RUN_PAGES = [
  "https://www.linkedin.com/jobs/", // "Top job picks for you"
];
// Your own jobs: the tracker lists the ones you saved (Job Finder puts those on its Apply Queue). Read after the rest.
const RUN_OWN_PAGES = [
  "https://www.linkedin.com/jobs-tracker/",
];
// LinkedIn's job collections (the lists under "More jobs for you"). Each is read page by page (RUN_LIST_STEP jobs
// a page) until a page brings no jobs it hadn't seen this run, or RUN_LIST_PAGES pages. A collection LinkedIn
// doesn't offer you just brings nothing.
const RUN_COLLECTIONS = [
  "recommended", // "Recommended for you"
  "top-applicant", // "Jobs where you'd be a top applicant"
  "still-hiring", // "Still hiring"
  "easy-apply", // "Easy Apply"
  "remote-jobs", // "Remote"
  "hybrid", // "Hybrid"
  "small-business", // "Small businesses"
  "fair-chance", // "Fair chance employers"
  "part-time-jobs", // "Part-time"
  "recently-posted", // "Recently posted"
].map((name) => `https://www.linkedin.com/jobs/collections/${name}/`);
const RUN_LIST_PAGES = 3;
const RUN_LIST_STEP = 25;
// Companies you want checked every run: their own LinkedIn jobs pages. Add more lines here.
const RUN_COMPANY_PAGES = [
  "https://www.linkedin.com/company/flywheel-digital/jobs/", // Flywheel
];
const RUN_MAX_OPENED = 10; // new jobs opened per run for their details
const RUN_GAP_MS = [20000, 45000]; // time between opening jobs, picked at random
const RUN_PAGE_WAIT_MS = [12000, 20000]; // time on each list page for its jobs to load
const RUN_LOAD_TIMEOUT_MS = 45000;
const RUN_KEEP = 20; // finished runs kept in the list
// Pages that mean "stop now": signing in, or any LinkedIn security check.
const SIGN_IN_PAGE = /linkedin\.com\/(?:login|uas\/login|authwall|signup)/i;
const OTHER_SECURITY_PAGE = /captcha|challenge|access-?denied|blocked|forbidden|unusual-?traffic/i; // USAJOBS and Maryland
const SITE_NAMES = { linkedin: "LinkedIn", usajobs: "USAJOBS", mwe: "Maryland Workforce Exchange", jobaps: "State of Maryland jobs" };
const USAJOBS_TITLES = 15; // most Job Finder titles searched on USAJOBS (a run takes longer with more)
const USAJOBS_PAGES = 3;
const MWE_PAGES = 15; // most page numbers clicked in one run
const MWE_GAP_MS = [25000, 60000]; // time on each Maryland page before the next number is clicked
const SECURITY_PAGE = /linkedin\.com\/(?:checkpoint|captcha|security|challenge)/i;

let activeRun = null; // { id, tabId, seen: Set, fresh: Set, stopped: { code, message } | null }

function randomBetween([low, high]) {
  return low + Math.random() * (high - low);
}

function findRun(id) {
  return state.runs.find((run) => run.id === id);
}

function sortRuns() {
  state.runs.sort((a, b) => a.when.localeCompare(b.when));
  const finished = state.runs.filter((run) => !["scheduled", "running"].includes(run.status));
  for (const old of finished.slice(0, Math.max(0, finished.length - RUN_KEEP))) {
    state.runs.splice(state.runs.indexOf(old), 1);
  }
}

// ---------- scheduling ----------

function addRun(when, site = "linkedin") {
  const time = Date.parse(when);
  if (!Number.isFinite(time)) throw new Error("Pick a date and time for the run.");
  if (time < Date.now() - 60000) throw new Error("That time has already passed.");
  const run = { id: `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, site, when: new Date(time).toISOString(), status: "scheduled" };
  state.runs.push(run);
  sortRuns();
  browser.alarms.create(`run:${run.id}`, { when: time });
  return run;
}

function removeRun(id) {
  const run = findRun(id);
  if (!run || run.status === "running") return;
  browser.alarms.clear(`run:${id}`);
  state.runs.splice(state.runs.indexOf(run), 1);
}

// At startup: runs whose time passed while Firefox was closed happen now if it's still the same day, otherwise
// they're tagged Missed. Alarms are set again for runs still to come.
function catchUpRuns() {
  const today = localDay();
  for (const run of state.runs) {
    if (run.status === "running") finishRun(run, "stopped", ERRORS.runFailed, "Firefox closed while the run was going.");
    if (run.status !== "scheduled") continue;
    const time = Date.parse(run.when);
    if (time > Date.now()) {
      browser.alarms.create(`run:${run.id}`, { when: time });
    } else if (localDay(new Date(time)) === today) {
      run.late = true;
      setTimeout(() => startRun(run.id), 15000); // give Firefox a moment after starting
    } else {
      run.status = "missed";
      run.message = "Firefox wasn't open on that day.";
    }
  }
}

// ---------- doing a run ----------

function finishRun(run, status, code, message) {
  Object.assign(run, { status, code: code || null, message: message || "", finished: new Date().toISOString() });
  const site = run.site || "linkedin";
  if (status === "stopped" && code === ERRORS.securityCheck) {
    if (site === "linkedin") state.securityCheckDay = localDay();
    else state.siteBlockedDay = { ...(state.siteBlockedDay || {}), [site]: localDay() };
  }
  if (status === "stopped") state.runAlert = { code, message, site };
  persist();
  updateBadge();
}

// Opens a page in the run's tab and waits for it to finish loading.
function openInRunTab(url) {
  if (activeRun.stopped) return Promise.reject(activeRun.stopped);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      resolve(); // a slow page still gets checked below
    }, RUN_LOAD_TIMEOUT_MS);
    const listener = (tabId, change) => {
      if (tabId !== activeRun.tabId || change.status !== "complete") return;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    browser.tabs.onUpdated.addListener(listener);
    browser.tabs.update(activeRun.tabId, { url }).catch((error) => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
  });
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The "Show all" links on the jobs home ("More jobs for you", "Jobs that match your profile", "Jobs based on your
// preferences" and the rest): every collection the page points to, so lists LinkedIn adds later are read too.
async function collectionLinks() {
  try {
    const [hrefs] = await browser.tabs.executeScript(activeRun.tabId, {
      code: "[...document.querySelectorAll('a[href*=\"/jobs/collections/\"]')].map((a) => a.href)",
    });
    const found = new Set();
    for (const href of hrefs || []) {
      const match = /^https:\/\/www\.linkedin\.com\/jobs\/collections\/([\w-]+)/.exec(href);
      if (match) found.add(`https://www.linkedin.com/jobs/collections/${match[1]}/`);
    }
    return [...found];
  } catch (error) {
    return []; // the page couldn't be read: the known collections are still read
  }
}

// After every page: a sign-in page or a security check ends the run at once.
async function checkRunTab() {
  if (activeRun.stopped) throw activeRun.stopped;
  let tab;
  try {
    tab = await browser.tabs.get(activeRun.tabId);
  } catch (error) {
    throw { code: ERRORS.runTabClosed, message: "The run's tab was closed." };
  }
  const name = SITE_NAMES[activeRun.site] || "The site";
  if ((activeRun.site === "linkedin" ? SECURITY_PAGE : OTHER_SECURITY_PAGE).test(tab.url || "")) {
    throw { code: ERRORS.securityCheck, message: `${name} showed a security check. No more ${name} runs today.` };
  }
  if (activeRun.site === "linkedin" && SIGN_IN_PAGE.test(tab.url || "")) {
    throw { code: ERRORS.signIn, message: "LinkedIn asked you to sign in. Sign in, then schedule another run." };
  }
}

// One page of a run: open it, give it time to load its jobs, and say whether it brought jobs not seen yet this run.
async function readRunPage(url) {
  const before = activeRun.seen.size;
  await openInRunTab(url);
  await checkRunTab();
  await pause(randomBetween(RUN_PAGE_WAIT_MS));
  await checkRunTab();
  return activeRun.seen.size > before;
}

// LinkedIn: the jobs home, every collection (page by page), the watched companies' pages and your tracker, then up to
// 10 new jobs opened for their details.
async function runLinkedin(run) {
  const lists = new Set(RUN_COLLECTIONS);
  for (const page of RUN_PAGES) {
    await readRunPage(page);
    for (const found of await collectionLinks()) lists.add(found);
  }
  for (const list of lists) {
    for (let index = 0; index < RUN_LIST_PAGES; index += 1) {
      const url = index ? `${list}?start=${index * RUN_LIST_STEP}` : list;
      if (!(await readRunPage(url))) break; // nothing new: the list has run out (or doesn't exist)
    }
  }
  for (const page of RUN_COMPANY_PAGES) await readRunPage(page);
  for (const page of RUN_OWN_PAGES) await readRunPage(page);
  const toOpen = [...activeRun.fresh].map((key) => state.jobs[key])
    .filter((job) => job && job.level !== "opened" && !job.closed).slice(0, RUN_MAX_OPENED);
  for (const job of toOpen) {
    await pause(randomBetween(RUN_GAP_MS));
    await checkRunTab();
    await openInRunTab(job.url);
    await checkRunTab();
    await pause(randomBetween(RUN_PAGE_WAIT_MS)); // time on the job's page for its details to be read
    await checkRunTab();
    run.opened += 1;
    persist();
  }
}

// USAJOBS: your Job Finder titles (up to USAJOBS_TITLES), searched in Maryland, a few result pages each. The titles are
// asked for again first, so a title added in Job Finder since the last daily check is searched too.
async function runUsajobs(run) {
  await refreshProfile(true).catch(() => {}); // Job Finder not open: the titles already kept are used
  const saved = await browser.storage.local.get("fitProfile");
  const titles = ((saved.fitProfile && saved.fitProfile.titles) || []).slice(0, USAJOBS_TITLES);
  if (!titles.length) {
    throw { code: ERRORS.runFailed, message: "No job titles yet. In the panel, click Check now under Fit markers so Job Finder's titles are loaded." };
  }
  for (const title of titles) {
    for (let page = 1; page <= USAJOBS_PAGES; page += 1) {
      const url = `https://www.usajobs.gov/search/results/?${new URLSearchParams({ k: title, l: "Maryland", p: String(page) })}`;
      if (!(await readRunPage(url)) && page > 1) break;
      await pause(randomBetween(RUN_GAP_MS));
    }
  }
}

// Maryland Workforce Exchange: starts from the search results you opened yourself (set your search terms first) and
// clicks the site's own page numbers 2, 3, 4... one at a time, with a pause between each. Its tab stays yours.
async function runMwe(run) {
  const tabs = await browser.tabs.query({ url: ["https://mwejobs.maryland.gov/*", "https://www.mwejobs.maryland.gov/*"] });
  const tab = tabs.find((candidate) => /\/jobbanks\/joblist\.aspx/i.test(candidate.url || ""));
  if (!tab) {
    throw { code: ERRORS.runFailed, message: "Open your Maryland Workforce Exchange search results first (set your search terms and search), then run again." };
  }
  activeRun.tabId = tab.id;
  activeRun.ownsTab = false;
  await pause(randomBetween([3000, 6000]));
  for (let step = 0; step < MWE_PAGES; step += 1) {
    await checkRunTab();
    const [clicked] = await browser.tabs.executeScript(tab.id, {
      code: `(() => {
        const active = document.querySelector("ul.pagination li.active");
        const next = active && active.nextElementSibling;
        const link = next && !next.classList.contains("disabled") ? next.querySelector("a.page-link") : null;
        if (!link) return "";
        const label = link.textContent.trim() || "next";
        link.click();
        return label;
      })()`,
    });
    if (!clicked) break; // no further page number: the last page has been read
    run.pages = (run.pages || 0) + 1;
    await pause(randomBetween(MWE_GAP_MS)); // the page's jobs load and are saved as they appear
    await checkRunTab();
    persist();
  }
}

// The State of Maryland's job feed: one request for every open job, no browsing.
async function runJobaps(run) {
  const before = new Set(Object.keys(state.jobs));
  await refreshFeed();
  if (state.errors.jobaps) throw { code: ERRORS.feed, message: state.errors.jobaps.message };
  const keys = Object.keys(state.jobs).filter((key) => state.jobs[key].site === "jobaps");
  activeRun.seen = new Set(keys);
  activeRun.fresh = new Set(keys.filter((key) => !before.has(key)));
}

const RUN_SITES = { linkedin: runLinkedin, usajobs: runUsajobs, mwe: runMwe, jobaps: runJobaps };

async function startRun(id) {
  await ready;
  const run = findRun(id);
  if (!run || run.status !== "scheduled") return;
  const site = run.site || "linkedin";
  const name = SITE_NAMES[site] || site;
  if (activeRun) {
    finishRun(run, "stopped", ERRORS.runFailed, "Another run was still going.");
    return;
  }
  if (site === "linkedin" ? state.securityCheckDay === localDay() : (state.siteBlockedDay || {})[site] === localDay()) {
    finishRun(run, "stopped", ERRORS.securityCheck, `Skipped: ${name} showed a security check earlier today.`);
    return;
  }
  if (!state.settings.enabled[site]) {
    finishRun(run, "stopped", ERRORS.runFailed, `${name} capture is turned off in the panel.`);
    return;
  }
  Object.assign(run, { status: "running", started: new Date().toISOString(), seen: 0, fresh: 0, opened: 0 });
  persist();
  let tab = null;
  if (site === "linkedin" || site === "usajobs") {
    try {
      tab = await browser.tabs.create({ url: "about:blank", active: false });
    } catch (error) {
      finishRun(run, "stopped", ERRORS.runFailed, `Couldn't open a tab: ${error.message || error}`);
      return;
    }
  }
  activeRun = { id, site, tabId: tab ? tab.id : null, ownsTab: Boolean(tab), seen: new Set(), fresh: new Set(), stopped: null };
  try {
    await RUN_SITES[site](run);
    run.seen = activeRun.seen.size;
    run.fresh = activeRun.fresh.size;
    const parts = [`${run.seen} jobs`, `${run.fresh} new`];
    if (site === "linkedin") parts.push(`${run.opened} opened for details`);
    if (site === "mwe") parts.push(`${run.pages || 0} more pages read`);
    finishRun(run, "done", null, parts.join(", "));
  } catch (problem) {
    run.seen = activeRun.seen.size;
    run.fresh = activeRun.fresh.size;
    const code = problem && problem.code ? problem.code : ERRORS.runFailed;
    finishRun(run, "stopped", code, problem && problem.message ? problem.message : String(problem));
  } finally {
    const { tabId, ownsTab } = activeRun;
    activeRun = null;
    if (tabId !== null && ownsTab) browser.tabs.remove(tabId).catch(() => {});
    flush(true);
  }
}

// ---------- hooks used by background.js ----------

// Jobs read from the run's tab count toward its result.
function runSawJobs(tabId, keys, freshKeys) {
  if (!activeRun || tabId !== activeRun.tabId) return;
  for (const key of keys) activeRun.seen.add(key);
  for (const key of freshKeys) activeRun.fresh.add(key);
}

function isRunTab(tabId) {
  return Boolean(activeRun && tabId === activeRun.tabId);
}

function runTabClosed(tabId) {
  if (isRunTab(tabId)) activeRun.stopped = { code: ERRORS.runTabClosed, message: "The run's tab was closed." };
}

function runsForPopup() {
  return state.runs.map((run) => ({ ...run }));
}

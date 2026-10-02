// Scheduled LinkedIn runs: at a date and time you pick, Firefox opens LinkedIn's recommended-jobs pages in a
// background tab, collects the jobs the usual way (the page's own data, read by content/capture.js and
// background.js), opens up to 10 new jobs for their details at a human pace, and closes the tab.
// Each run gets a result tag: Scheduled, Running, Done, Stopped (with an error code) or Missed.
// It stops at once on a sign-in page or any security check, and no further run happens that day.
// Loaded after background.js and shares its globals (state, ERRORS, persist, updateBadge, localDay).
"use strict";

const RUN_PAGES = [
  "https://www.linkedin.com/jobs/", // "Top job picks for you"
  "https://www.linkedin.com/jobs/collections/recommended/", // "Recommended for you"
];
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

function addRun(when) {
  const time = Date.parse(when);
  if (!Number.isFinite(time)) throw new Error("Pick a date and time for the run.");
  if (time < Date.now() - 60000) throw new Error("That time has already passed.");
  const run = { id: `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, when: new Date(time).toISOString(), status: "scheduled" };
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
  if (status === "stopped" && code === ERRORS.securityCheck) state.securityCheckDay = localDay();
  if (status === "stopped") state.runAlert = { code, message };
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

// After every page: a sign-in page or a security check ends the run at once.
async function checkRunTab() {
  if (activeRun.stopped) throw activeRun.stopped;
  let tab;
  try {
    tab = await browser.tabs.get(activeRun.tabId);
  } catch (error) {
    throw { code: ERRORS.runTabClosed, message: "The run's tab was closed." };
  }
  if (SECURITY_PAGE.test(tab.url || "")) {
    throw { code: ERRORS.securityCheck, message: "LinkedIn showed a security check. No more runs today." };
  }
  if (SIGN_IN_PAGE.test(tab.url || "")) {
    throw { code: ERRORS.signIn, message: "LinkedIn asked you to sign in. Sign in, then schedule another run." };
  }
}

async function startRun(id) {
  await ready;
  const run = findRun(id);
  if (!run || run.status !== "scheduled") return;
  if (activeRun) {
    finishRun(run, "stopped", ERRORS.runFailed, "Another run was still going.");
    return;
  }
  if (state.securityCheckDay === localDay()) {
    finishRun(run, "stopped", ERRORS.securityCheck, "Skipped: LinkedIn showed a security check earlier today.");
    return;
  }
  if (!state.settings.enabled.linkedin) {
    finishRun(run, "stopped", ERRORS.runFailed, "LinkedIn capture is turned off in the panel.");
    return;
  }
  Object.assign(run, { status: "running", started: new Date().toISOString(), seen: 0, fresh: 0, opened: 0 });
  persist();
  let tab;
  try {
    tab = await browser.tabs.create({ url: "about:blank", active: false });
  } catch (error) {
    finishRun(run, "stopped", ERRORS.runFailed, `Couldn't open a tab: ${error.message || error}`);
    return;
  }
  activeRun = { id, tabId: tab.id, seen: new Set(), fresh: new Set(), stopped: null };
  try {
    // 1. The recommended-jobs pages and the watched companies' jobs pages: page 1 of each.
    for (const page of [...RUN_PAGES, ...RUN_COMPANY_PAGES]) {
      await openInRunTab(page);
      await checkRunTab();
      await pause(randomBetween(RUN_PAGE_WAIT_MS));
      await checkRunTab();
    }
    // 2. Up to 10 new jobs it doesn't have details for yet, one at a time.
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
    run.seen = activeRun.seen.size;
    run.fresh = activeRun.fresh.size;
    finishRun(run, "done", null, `${run.seen} jobs, ${run.fresh} new, ${run.opened} opened for details`);
  } catch (problem) {
    run.seen = activeRun.seen.size;
    run.fresh = activeRun.fresh.size;
    const code = problem && problem.code ? problem.code : ERRORS.runFailed;
    finishRun(run, "stopped", code, problem && problem.message ? problem.message : String(problem));
  } finally {
    const tabId = activeRun.tabId;
    activeRun = null;
    browser.tabs.remove(tabId).catch(() => {});
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

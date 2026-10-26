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
// Your own jobs: the tracker lists the ones you saved (Job Finder puts those on its Apply Queue) and the ones you
// applied to (checked for closed listings). Read after the rest.
const RUN_OWN_PAGES = [
  "https://www.linkedin.com/jobs-tracker/",
  "https://www.linkedin.com/jobs-tracker/?stage=applied",
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
const RUN_SCROLL_WAIT_MS = [3000, 6000]; // time after each scroll of the tracker for more jobs to load
const RUN_LOAD_TIMEOUT_MS = 45000;
const RUN_KEEP = 20; // finished runs kept in the list
// Pages that mean "stop now": signing in, or any LinkedIn security check.
const SIGN_IN_PAGE = /linkedin\.com\/(?:login|uas\/login|authwall|signup)/i;
const OTHER_SECURITY_PAGE = /captcha|challenge|access-?denied|blocked|forbidden|unusual-?traffic/i; // USAJOBS and Maryland
const SITE_NAMES = { linkedin: "LinkedIn", usajobs: "USAJOBS", mwe: "Maryland Workforce Exchange", indeed: "Indeed", jobaps: "State of Maryland jobs" };
const USAJOBS_TITLES = 15; // most Job Finder titles searched on USAJOBS (a run takes longer with more)
const USAJOBS_PAGES = 3;
const MWE_TITLES = 15; // most Job Finder titles searched on Maryland Workforce Exchange
const MWE_SEARCH_PAGE = "https://mwejobs.maryland.gov/vosnet/JobBanks/JobSearchCriteriaQuick.aspx";
const MWE_PAGES = 15; // most page numbers clicked in one run
const MWE_GAP_MS = [25000, 60000]; // time on each Maryland page before the next number is clicked
const MWE_MAX_OPENED = 40; // job pages opened for details in a normal Maryland run; a "full" run has no limit
const RUN_TAB_PAGES = 10; // pages loaded in one run tab before it is closed and a fresh one opened (frees Firefox's memory)
const INDEED_TITLES = 10; // most Job Finder titles searched on Indeed
const INDEED_SEARCH_PAGE = "https://www.indeed.com/";
const INDEED_PAGES = 4; // most "next page" clicks per title
const INDEED_GAP_MS = [25000, 60000]; // time on each Indeed page before the next one is clicked
const SECURITY_PAGE = /linkedin\.com\/(?:checkpoint|captcha|security|challenge)/i;

// One run at a time per site, so different sites can run together: site -> { id, site, tabId, seen: Set, fresh: Set, stopped: { code, message } | null }
const activeRuns = new Map();

function runForTab(tabId) {
  for (const active of activeRuns.values()) if (active.tabId === tabId) return active;
  return null;
}

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

function addRun(when, site = "linkedin", all = false) {
  const time = Date.parse(when);
  if (!Number.isFinite(time)) throw new Error("Pick a date and time for the run.");
  if (time < Date.now() - 60000) throw new Error("That time has already passed.");
  const run = { id: `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, site, when: new Date(time).toISOString(), status: "scheduled" };
  if (all) run.all = true; // a full run: no limit on the job pages opened for details
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

// Swaps the run's tab for a new one so the memory the old pages used is freed. A tab that was already open
// (yours) is left open; the run carries on in a tab of its own.
async function freshRunTab(activeRun) {
  const created = await browser.tabs.create({ url: "about:blank", active: false });
  const old = { tabId: activeRun.tabId, ownsTab: activeRun.ownsTab };
  Object.assign(activeRun, { tabId: created.id, ownsTab: true, pagesInTab: 0 });
  if (old.tabId !== null && old.ownsTab) await browser.tabs.remove(old.tabId).catch(() => {});
}

// Opens a page in the run's tab and waits for it to finish loading.
async function openInRunTab(activeRun, url) {
  if (activeRun.stopped) throw activeRun.stopped;
  if (activeRun.ownsTab && (activeRun.pagesInTab || 0) >= RUN_TAB_PAGES) await freshRunTab(activeRun);
  activeRun.pagesInTab = (activeRun.pagesInTab || 0) + 1;
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
async function collectionLinks(activeRun) {
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
async function checkRunTab(activeRun) {
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
async function readRunPage(activeRun, url) {
  const before = activeRun.seen.size;
  await openInRunTab(activeRun, url);
  await checkRunTab(activeRun);
  await pause(randomBetween(RUN_PAGE_WAIT_MS));
  await checkRunTab(activeRun);
  return activeRun.seen.size > before;
}

// The tracker shows only its first cards; the rest load as the page is scrolled or "Show more" is pressed. Does that
// until a round brings no new jobs (at most RUN_TRACKER_ROUNDS), so every applied job is read and can be compared with
// what Job Finder already has.
const RUN_TRACKER_ROUNDS = 25;
async function loadWholeTracker(activeRun) {
  let last = -1;
  for (let round = 0; round < RUN_TRACKER_ROUNDS; round += 1) {
    let count;
    try {
      [count] = await browser.tabs.executeScript(activeRun.tabId, {
        code: `(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          for (const node of document.querySelectorAll("button, a[role='button']")) {
            if (/^\\s*(show|see|load) more\\b/i.test(node.textContent || "")) node.click();
          }
          return new Set([...document.querySelectorAll("a[href*='/jobs/view/']")]
            .map((a) => (/\\/jobs\\/view\\/(\\d+)/.exec(a.href) || [])[1]).filter(Boolean)).size;
        })()`,
      });
    } catch (error) {
      return; // the page couldn't be scrolled: what loaded is still read
    }
    if (count === last) return;
    last = count;
    await pause(randomBetween(RUN_SCROLL_WAIT_MS));
    await checkRunTab(activeRun);
  }
}

// LinkedIn: the jobs home, every collection (page by page), the watched companies' pages and your tracker, then up to
// 10 new jobs opened for their details.
async function runLinkedin(run, activeRun) {
  const lists = new Set(RUN_COLLECTIONS);
  for (const page of RUN_PAGES) {
    await readRunPage(activeRun, page);
    for (const found of await collectionLinks(activeRun)) lists.add(found);
  }
  for (const list of lists) {
    for (let index = 0; index < RUN_LIST_PAGES; index += 1) {
      const url = index ? `${list}?start=${index * RUN_LIST_STEP}` : list;
      if (!(await readRunPage(activeRun, url))) break; // nothing new: the list has run out (or doesn't exist)
    }
  }
  for (const page of RUN_COMPANY_PAGES) await readRunPage(activeRun, page);
  for (const page of RUN_OWN_PAGES) {
    await readRunPage(activeRun, page);
    if (/[?&]stage=applied\b/.test(page)) await loadWholeTracker(activeRun);
  }
  const toOpen = [...activeRun.fresh].map((key) => state.jobs[key])
    .filter((job) => job && job.level !== "opened" && !job.closed).slice(0, RUN_MAX_OPENED);
  for (const job of toOpen) {
    await pause(randomBetween(RUN_GAP_MS));
    await checkRunTab(activeRun);
    await openInRunTab(activeRun, job.url);
    await checkRunTab(activeRun);
    await pause(randomBetween(RUN_PAGE_WAIT_MS)); // time on the job's page for its details to be read
    await checkRunTab(activeRun);
    run.opened += 1;
    persist();
  }
}

// Your Job Finder titles (asked for again first, so a title added since the last daily check is included).
async function jobFinderTitles(limit) {
  await refreshProfile(true).catch(() => {}); // Job Finder not open: the titles already kept are used
  const saved = await browser.storage.local.get("fitProfile");
  return ((saved.fitProfile && saved.fitProfile.titles) || []).slice(0, limit);
}

// USAJOBS: your Job Finder titles (up to USAJOBS_TITLES), searched in Maryland, a few result pages each. The titles are
// asked for again first, so a title added in Job Finder since the last daily check is searched too.
async function runUsajobs(run, activeRun) {
  const titles = await jobFinderTitles(USAJOBS_TITLES);
  if (!titles.length) {
    throw { code: ERRORS.runFailed, message: "No job titles yet. In the panel, click Check now under Fit markers so Job Finder's titles are loaded." };
  }
  for (const title of titles) {
    for (let page = 1; page <= USAJOBS_PAGES; page += 1) {
      const url = `https://www.usajobs.gov/search/results/?${new URLSearchParams({ k: title, l: "Maryland", p: String(page) })}`;
      if (!(await readRunPage(activeRun, url)) && page > 1) break;
      await pause(randomBetween(RUN_GAP_MS));
    }
  }
}

// Clicks the site's own page numbers 2, 3, 4... one at a time, with a pause between each.
async function mwePages(run, activeRun) {
  for (let step = 0; step < MWE_PAGES; step += 1) {
    await checkRunTab(activeRun);
    const [clicked] = await browser.tabs.executeScript(activeRun.tabId, {
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
    await checkRunTab(activeRun);
    persist();
  }
}

// The jobs this run saw from their result card only are opened one at a time, at a human pace, so their whole
// description is read (Job Finder finds a job's skills, and so its Job Fit, in the description).
async function mweOpenDetails(run, activeRun) {
  const unread = (job) => job && job.site === "mwe" && job.level !== "opened" && !job.closed && /\/jobbanks\/jobdetails\.aspx/i.test(job.url || "");
  // This run's jobs first (newest first), then every other job still unread. A normal run opens at most MWE_MAX_OPENED
  // (the rest wait for the next run); a full run has no limit and takes as long as it takes.
  const keys = [...new Set([...[...activeRun.seen].reverse(), ...Object.keys(state.jobs)])];
  const unreadJobs = keys.map((key) => state.jobs[key]).filter(unread);
  const toOpen = run.all ? unreadJobs : unreadJobs.slice(0, MWE_MAX_OPENED);
  if (!activeRun.ownsTab && toOpen.length) await freshRunTab(activeRun); // never browse many pages in your own tab
  for (const job of toOpen) {
    await pause(randomBetween(MWE_GAP_MS));
    await checkRunTab(activeRun);
    const startedAt = Date.now();
    await openInRunTab(activeRun, job.url);
    await checkRunTab(activeRun);
    await pause(randomBetween(RUN_PAGE_WAIT_MS)); // time on the job's page for its details to be read
    await checkRunTab(activeRun);
    mergeOpenedMwe(job, startedAt);
    run.opened += 1;
    persist();
  }
}

// A job's own page can name the employer and place differently than its card did ("Baltimore, MD - 21230"), and a job is
// known by title, employer and place, so the page is saved as a second record. Its description, pay and date are moved
// onto the card's record (which then counts as opened, and is not opened again) and the second record is dropped.
function mergeOpenedMwe(card, since) {
  const title = String(card.title || "").toLowerCase();
  const key = `mwe:${card.job_id}`;
  for (const [otherKey, other] of Object.entries(state.jobs)) {
    if (otherKey === key || other.site !== "mwe" || other.level !== "opened" || Date.parse(other.last_seen) < since) continue;
    if (String(other.title || "").toLowerCase() !== title) continue;
    for (const field of ["description", "salary", "posted", "work_arrangement"]) if (other[field]) card[field] = other[field];
    if (!card.company && other.company) card.company = other.company;
    card.level = "opened";
    card.closed = Boolean(other.closed);
    card.last_seen = other.last_seen;
    card.changed_at = other.last_seen;
    state.dirty.add(`mwe|${localDay()}`);
    delete state.jobs[otherKey];
    return;
  }
}

// Types a title into the search form's keyword box and presses its Search button. Returns "" when done, or why not.
function mweSearchCode(title) {
  return `(() => {
    const visible = (el) => el.offsetParent !== null;
    const label = (el) => [el.id, el.name, el.placeholder, el.getAttribute("aria-label"),
      (el.labels && el.labels[0] && el.labels[0].textContent) || ""].join(" ");
    const boxes = [...document.querySelectorAll("input[type=text], input[type=search], input:not([type])")].filter(visible);
    const box = boxes.find((el) => /key\\s*word|job\\s*title|search\\s*for/i.test(label(el))) || boxes[0];
    if (!box) return "no keyword box";
    box.focus();
    box.value = ${JSON.stringify(title)};
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
    const buttons = [...document.querySelectorAll("button, input[type=submit], input[type=button], a.btn")].filter(visible);
    const text = (el) => (el.value || el.textContent || "").trim();
    const go = buttons.find((el) => /^(search|find jobs|search jobs)\\b/i.test(text(el))) || buttons.find((el) => /search/i.test(text(el)));
    if (!go) return "no Search button";
    go.click();
    return "";
  })()`;
}

// Maryland Workforce Exchange: each of your Job Finder titles is typed into the site's search form (in your Firefox, at
// a human pace), then the site's own page numbers 2, 3, 4... are clicked one at a time. Uses your open Maryland tab and
// leaves it open; with none open, a tab of its own is used and closed. With no titles loaded it reads the search
// results you opened yourself instead.
async function runMwe(run, activeRun) {
  const tabs = await browser.tabs.query({ url: ["https://mwejobs.maryland.gov/*", "https://www.mwejobs.maryland.gov/*"] });
  const titles = await jobFinderTitles(MWE_TITLES);
  if (!titles.length) {
    const tab = tabs.find((candidate) => /\/jobbanks\/joblist\.aspx/i.test(candidate.url || ""));
    if (!tab) {
      throw { code: ERRORS.runFailed, message: "No job titles yet (click Check now under Fit markers so Job Finder's titles are loaded), and no Maryland Workforce Exchange search results are open." };
    }
    activeRun.tabId = tab.id;
    activeRun.ownsTab = false;
    await pause(randomBetween([3000, 6000]));
    await mwePages(run, activeRun);
    await mweOpenDetails(run, activeRun);
    return;
  }
  if (tabs.length) {
    activeRun.tabId = tabs[0].id;
    activeRun.ownsTab = false;
  } else {
    const created = await browser.tabs.create({ url: "about:blank", active: false });
    activeRun.tabId = created.id;
    activeRun.ownsTab = true;
  }
  for (const title of titles) {
    await openInRunTab(activeRun, MWE_SEARCH_PAGE);
    await checkRunTab(activeRun);
    await pause(randomBetween([3000, 6000]));
    const [problem] = await browser.tabs.executeScript(activeRun.tabId, { code: mweSearchCode(title) });
    if (problem) throw { code: ERRORS.runFailed, message: `Couldn't search Maryland Workforce Exchange for "${title}" (${problem}). Use Save this page for fixing on its search form.` };
    await pause(randomBetween([6000, 10000])); // the results load and are saved as they appear
    await checkRunTab(activeRun);
    await mwePages(run, activeRun);
    await pause(randomBetween(RUN_GAP_MS));
  }
  await mweOpenDetails(run, activeRun);
}

// Clicks Indeed's own "next page" arrow, one page at a time, with a pause between each.
async function indeedPages(run, activeRun) {
  for (let step = 0; step < INDEED_PAGES; step += 1) {
    await checkRunTab(activeRun);
    const [clicked] = await browser.tabs.executeScript(activeRun.tabId, {
      code: `(() => {
        const next = document.querySelector("a[data-testid='pagination-page-next'], a[aria-label='Next Page'], a[aria-label='Next']");
        if (!next) return false;
        next.click();
        return true;
      })()`,
    });
    if (!clicked) break; // no next arrow: the last page has been read
    run.pages = (run.pages || 0) + 1;
    await pause(randomBetween(INDEED_GAP_MS)); // the page's jobs load and are saved as they appear
    await checkRunTab(activeRun);
    persist();
  }
}

// Types a title and Maryland into Indeed's search boxes and presses Find jobs. Returns "" when done, or why not.
function indeedSearchCode(title) {
  return `(() => {
    const fill = (el, value) => {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const what = document.querySelector("#text-input-what, input[name='q']");
    if (!what) return "no job title box";
    fill(what, ${JSON.stringify(title)});
    const where = document.querySelector("#text-input-where, input[name='l']");
    if (where) fill(where, "Maryland");
    const go = document.querySelector("button[type=submit]") ||
      [...document.querySelectorAll("button")].find((el) => /find jobs|search/i.test(el.textContent || ""));
    if (!go) return "no Find jobs button";
    go.click();
    return "";
  })()`;
}

// Indeed: each of your Job Finder titles is typed into Indeed's search (in your Firefox, at a human pace), then its "next
// page" arrow is clicked a few times. Uses your open Indeed tab and leaves it open; with none open it uses its own.
async function runIndeed(run, activeRun) {
  const titles = await jobFinderTitles(INDEED_TITLES);
  if (!titles.length) {
    throw { code: ERRORS.runFailed, message: "No job titles yet. In the panel, click Check now under Fit markers so Job Finder's titles are loaded." };
  }
  const tabs = await browser.tabs.query({ url: ["https://www.indeed.com/*", "https://indeed.com/*"] });
  if (tabs.length) {
    activeRun.tabId = tabs[0].id;
    activeRun.ownsTab = false;
  } else {
    const created = await browser.tabs.create({ url: "about:blank", active: false });
    activeRun.tabId = created.id;
    activeRun.ownsTab = true;
  }
  for (const title of titles) {
    await openInRunTab(activeRun, INDEED_SEARCH_PAGE);
    await checkRunTab(activeRun);
    await pause(randomBetween([3000, 6000]));
    const [problem] = await browser.tabs.executeScript(activeRun.tabId, { code: indeedSearchCode(title) });
    if (problem) throw { code: ERRORS.runFailed, message: `Couldn't search Indeed for "${title}" (${problem}). Use Save this page for fixing on Indeed's home page.` };
    await pause(randomBetween([6000, 10000])); // the results load and are saved as they appear
    await checkRunTab(activeRun);
    await indeedPages(run, activeRun);
    await pause(randomBetween(RUN_GAP_MS));
  }
}

// The State of Maryland's job feed: one request for every open job, no browsing.
async function runJobaps(run, activeRun) {
  const before = new Set(Object.keys(state.jobs));
  await refreshFeed();
  if (state.errors.jobaps) throw { code: ERRORS.feed, message: state.errors.jobaps.message };
  const keys = Object.keys(state.jobs).filter((key) => state.jobs[key].site === "jobaps");
  activeRun.seen = new Set(keys);
  activeRun.fresh = new Set(keys.filter((key) => !before.has(key)));
}

const RUN_SITES = { linkedin: runLinkedin, usajobs: runUsajobs, mwe: runMwe, indeed: runIndeed, jobaps: runJobaps };

async function startRun(id) {
  await ready;
  const run = findRun(id);
  if (!run || run.status !== "scheduled") return;
  const site = run.site || "linkedin";
  const name = SITE_NAMES[site] || site;
  if (!RUN_SITES[site]) {
    finishRun(run, "stopped", ERRORS.runFailed, `${name} has no automatic runs; it saves jobs as you browse.`);
    return;
  }
  if (activeRuns.has(site)) {
    finishRun(run, "stopped", ERRORS.runFailed, `Another ${name} run was still going.`);
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
  const activeRun = { id, site, tabId: tab ? tab.id : null, ownsTab: Boolean(tab), seen: new Set(), fresh: new Set(), stopped: null };
  activeRuns.set(site, activeRun);
  try {
    await RUN_SITES[site](run, activeRun);
    run.seen = activeRun.seen.size;
    run.fresh = activeRun.fresh.size;
    const parts = [`${run.seen} jobs`, `${run.fresh} new`];
    if (site === "linkedin" || site === "mwe") parts.push(`${run.opened} opened for details`);
    if (site === "mwe" || site === "indeed") parts.push(`${run.pages || 0} more pages read`);
    finishRun(run, "done", null, parts.join(", "));
  } catch (problem) {
    run.seen = activeRun.seen.size;
    run.fresh = activeRun.fresh.size;
    const code = problem && problem.code ? problem.code : ERRORS.runFailed;
    finishRun(run, "stopped", code, problem && problem.message ? problem.message : String(problem));
  } finally {
    const { tabId, ownsTab } = activeRun;
    activeRuns.delete(site);
    if (tabId !== null && ownsTab) browser.tabs.remove(tabId).catch(() => {});
    else if (tabId !== null) settleFox(tabId);
    flush(true);
  }
}

// ---------- hooks used by background.js ----------

// Jobs read from the run's tab count toward its result.
function runSawJobs(tabId, keys, freshKeys) {
  const activeRun = runForTab(tabId);
  if (!activeRun) return;
  for (const key of keys) activeRun.seen.add(key);
  for (const key of freshKeys) activeRun.fresh.add(key);
}

function isRunTab(tabId) {
  return Boolean(runForTab(tabId));
}

function runTabClosed(tabId) {
  const activeRun = runForTab(tabId);
  if (activeRun) activeRun.stopped = { code: ERRORS.runTabClosed, message: "The run's tab was closed." };
}

function runsForPopup() {
  return state.runs.map((run) => ({ ...run }));
}

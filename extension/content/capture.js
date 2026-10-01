// Runs on the job sites you browse (LinkedIn, the Maryland Workforce Exchange). Reads the jobs on the page as you
// scroll, using the site's reader (sites/*-parse.js sets globalThis.CaptureParse), and sends them to background.js.
// Read-only: it never clicks, scrolls, navigates or fetches anything.
(function () {
  "use strict";

  const parse = globalThis.CaptureParse;
  const SETTLE_MS = 15000;
  const embeddedDone = new WeakSet();
  const sent = new Map(); // job_id -> JSON of what was last sent, so unchanged jobs aren't resent
  let pageUrl = location.href;
  let foundOnPage = 0;
  let lastJobs = [];
  let scanTimer = null;
  let settleTimer = null;

  function onJobsPage() {
    return parse.onJobsPage(location);
  }

  function scan() {
    scanTimer = null;
    if (!onJobsPage()) return;
    const embedded = parse.fromEmbedded ? parse.fromEmbedded(document, location.href, embeddedDone) : [];
    const jobs = [...embedded, ...parse.fromDom(document, location.href)];
    lastJobs = jobs;
    const fresh = [];
    for (const job of jobs) {
      const key = JSON.stringify(job);
      if (sent.get(job.job_id) === key) continue;
      sent.set(job.job_id, key);
      fresh.push(job);
    }
    foundOnPage = Math.max(foundOnPage, new Set(jobs.map((job) => job.job_id)).size);
    if (fresh.length) {
      browser.runtime.sendMessage({ type: "jobs", site: parse.SITE, pageUrl: location.href, jobs: fresh }).catch(() => {});
    }
  }

  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(scan, 1000);
  }

  // Sites like LinkedIn change pages without reloading, so each URL change counts as a new page view.
  function pageView() {
    pageUrl = location.href;
    foundOnPage = 0;
    lastJobs = [];
    clearTimeout(settleTimer);
    if (!onJobsPage()) return;
    browser.runtime.sendMessage({ type: "page-view", site: parse.SITE, pageUrl }).catch(() => {});
    settleTimer = setTimeout(() => {
      scan();
      browser.runtime.sendMessage({
        type: "page-settled", site: parse.SITE, pageUrl, found: foundOnPage, expectsJobs: parse.expectsJobs(pageUrl),
        // The job open on this page (its own page, or a details pane next to a list), so the background can check
        // that its details were read.
        detailJobId: parse.detailId(pageUrl, lastJobs),
      }).catch(() => {});
    }, SETTLE_MS);
    scheduleScan();
  }

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => {
    if (location.href !== pageUrl) pageView();
  }, 1000);

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "get-page-html") {
      return Promise.resolve({ url: location.href, html: document.documentElement.outerHTML });
    }
    return undefined;
  });

  pageView();
})();

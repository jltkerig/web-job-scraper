// Runs on LinkedIn pages. Reads jobs from the embedded JSON and the visible page as you scroll,
// and sends them to background.js. Read-only: it never clicks, scrolls or navigates.
(function () {
  "use strict";

  const parse = globalThis.LinkedInParse;
  const SETTLE_MS = 15000;
  const embeddedDone = new WeakSet();
  const sent = new Map(); // job_id -> JSON of what was last sent, so unchanged jobs aren't resent
  let pageUrl = location.href;
  let foundOnPage = 0;
  let scanTimer = null;
  let settleTimer = null;

  function onJobsPage() {
    return location.pathname.startsWith("/jobs");
  }

  function scan() {
    scanTimer = null;
    if (!onJobsPage()) return;
    const jobs = [...parse.fromEmbedded(document, location.href, embeddedDone), ...parse.fromDom(document, location.href)];
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

  // LinkedIn changes pages without reloading, so each URL change counts as a new page view.
  function pageView() {
    pageUrl = location.href;
    foundOnPage = 0;
    clearTimeout(settleTimer);
    if (!onJobsPage()) return;
    browser.runtime.sendMessage({ type: "page-view", site: parse.SITE, pageUrl }).catch(() => {});
    settleTimer = setTimeout(() => {
      scan();
      browser.runtime.sendMessage({
        type: "page-settled", site: parse.SITE, pageUrl, found: foundOnPage, expectsJobs: parse.expectsJobs(pageUrl),
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

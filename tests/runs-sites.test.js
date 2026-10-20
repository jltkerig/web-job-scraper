// Runs on the other websites (runs.js): Maryland Workforce Exchange page clicking, USAJOBS searches and the Maryland
// state feed, with a stand-in Firefox where every wait is instant. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "extension", "runs.js"), "utf8");
const MWE_RESULTS = "https://mwejobs.maryland.gov/vosnet/jobbanks/joblist.aspx?enc=abc";

function sandbox({ titles = ["Web Designer", "Graphic Designer"], pagesAvailable = 4, mweTabs = [{ id: 7, url: MWE_RESULTS }], feedError = false } = {}) {
  const listeners = new Set();
  const tabs = new Map();
  let nextTab = 1;
  let clicks = 0;
  const searched = [];
  const context = {
    console, Date, Math, Promise, URLSearchParams,
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout,
    ready: Promise.resolve(),
    ERRORS: { signIn: "E7006", securityCheck: "E7007", runTabClosed: "E7008", runFailed: "E7009", feed: "E7010" },
    state: { runs: [], jobs: {}, errors: {}, settings: { enabled: { linkedin: true, mwe: true, usajobs: true, jobaps: true } },
      securityCheckDay: null, siteBlockedDay: {}, runAlert: null },
    persist: () => Promise.resolve(), updateBadge: () => {}, flush: () => Promise.resolve(), settleFox: () => {},
    localDay: (date = new Date()) => date.toISOString().slice(0, 10),
    visited: [],
    refreshProfile: async () => {},
    refreshFeed: async () => {
      if (feedError) context.state.errors.jobaps = { code: "E7010", message: "Could not read the feed" };
      else context.state.jobs["jobaps:1"] = { site: "jobaps" }, context.state.jobs["jobaps:2"] = { site: "jobaps" };
    },
    browser: {
      alarms: { create() {}, clear() {} },
      storage: { local: { get: async () => ({ fitProfile: { titles } }) } },
      tabs: {
        onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
        create: async () => { const id = nextTab++; tabs.set(id, { id, url: "about:blank" }); return { id }; },
        update: async (id, { url }) => {
          const tab = tabs.get(id) || mweTabs.find((candidate) => candidate.id === id);
          tab.url = url;
          context.visited.push(url);
          const key = `usajobs:${context.visited.length}`;
          context.state.jobs[key] = { site: "usajobs" };
          context.runSawJobs(id, [key], [key]);
          setTimeout(() => listeners.forEach((fn) => fn(id, { status: "complete" })), 0);
          return tab;
        },
        get: async (id) => (tabs.get(id) || mweTabs.find((tab) => tab.id === id) || (() => { throw new Error("no tab"); })()),
        remove: async (id) => tabs.delete(id),
        query: async () => mweTabs,
        // the Maryland pager: clicks page numbers until the last one
        executeScript: async (tabId, { code }) => {
          searched.push(code);
          if (/no keyword box/.test(code)) return [""]; // the search form being filled in
          clicks += 1; return [clicks < pagesAvailable ? String(clicks + 1) : ""]; },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  return { context, tabs, clicks: () => clicks, searched };
}

async function runSite(context, site) {
  const run = context.addRun(new Date().toISOString(), site);
  await context.startRun(run.id);
  return context.state.runs.find((item) => item.id === run.id);
}

test("a Maryland run clicks the page numbers on the tab you opened and leaves that tab alone", async () => {
  const { context, clicks } = sandbox({ titles: [], pagesAvailable: 4 });
  const run = await runSite(context, "mwe");
  assert.strictEqual(run.status, "done");
  assert.strictEqual(run.pages, 3); // pages 2, 3 and 4 after the page you were on
  assert.strictEqual(clicks(), 4); // the fourth look found no further number
  assert.match(run.message, /3 more pages read/);
  assert.deepStrictEqual(context.visited, [], "the run must not open Maryland pages itself");
});

test("a Maryland run without a results tab says what to do", async () => {
  const { context } = sandbox({ titles: [], mweTabs: [] });
  const run = await runSite(context, "mwe");
  assert.strictEqual(run.status, "stopped");
  assert.match(run.message, /no Maryland Workforce Exchange search results are open/);
});

test("a Maryland security check ends the run and blocks Maryland runs for the day, not LinkedIn's", async () => {
  const { context } = sandbox({ titles: [], mweTabs: [{ id: 7, url: "https://mwejobs.maryland.gov/vosnet/jobbanks/joblist.aspx?captcha=1" }] });
  const run = await runSite(context, "mwe");
  assert.strictEqual(run.status, "stopped");
  assert.strictEqual(run.code, "E7007");
  assert.strictEqual(context.state.siteBlockedDay.mwe, context.localDay());
  assert.strictEqual(context.state.securityCheckDay, null);
  const again = await runSite(context, "mwe");
  assert.match(again.message, /Skipped/);
});

test("a USAJOBS run searches your Job Finder titles in Maryland and closes its tab", async () => {
  const { context, tabs } = sandbox();
  const run = await runSite(context, "usajobs");
  assert.strictEqual(run.status, "done");
  assert.ok(context.visited.some((url) => /k=Web\+Designer&l=Maryland&p=1/.test(url)));
  assert.ok(context.visited.some((url) => /k=Graphic\+Designer&l=Maryland&p=3/.test(url)));
  assert.strictEqual(tabs.size, 0);
});

test("a USAJOBS run with no titles loaded says so", async () => {
  const { context } = sandbox({ titles: [] });
  const run = await runSite(context, "usajobs");
  assert.strictEqual(run.status, "stopped");
  assert.match(run.message, /No job titles yet/);
});

test("the State of Maryland run reads the feed and counts the jobs", async () => {
  const { context } = sandbox();
  const run = await runSite(context, "jobaps");
  assert.strictEqual(run.status, "done");
  assert.strictEqual(run.seen, 2);
  assert.strictEqual(run.fresh, 2);
  const failed = await runSite(sandbox({ feedError: true }).context, "jobaps");
  assert.strictEqual(failed.status, "stopped");
  assert.strictEqual(failed.code, "E7010");
});

test("runs keep their site, and a stopped run's alert names it", async () => {
  const { context } = sandbox({ titles: [], mweTabs: [] });
  const run = await runSite(context, "mwe");
  assert.strictEqual(run.site, "mwe");
  assert.strictEqual(context.state.runAlert.site, "mwe");
});

test("a Maryland run types each Job Finder title into the search form, in your open tab", async () => {
  const { context, clicks, searched } = sandbox({ pagesAvailable: 2 });
  const run = await runSite(context, "mwe");
  assert.strictEqual(run.status, "done", run.message);
  assert.strictEqual(context.visited.length, 2); // the search form, once per title
  assert.ok(context.visited.every((url) => /JobSearchCriteriaQuick\.aspx/.test(url)));
  assert.ok(searched.some((code) => code.includes('"Web Designer"')));
  assert.ok(searched.some((code) => code.includes('"Graphic Designer"')));
  assert.strictEqual(run.pages, 1); // the stub offers one page number in all
  assert.ok(clicks() > 0);
});

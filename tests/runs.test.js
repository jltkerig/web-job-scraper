// Scheduled LinkedIn runs (runs.js) with a stand-in Firefox where every wait is instant. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "extension", "runs.js"), "utf8");

// A sandbox with what runs.js uses from background.js, and a tab whose address is decided by `redirect`.
function sandbox({ redirect = (url) => url, jobsPerPage = 3 } = {}) {
  const listeners = new Set();
  const tabs = new Map();
  const alarms = new Map();
  let nextTab = 1;
  let jobNumber = 0;
  const context = {
    console,
    Date,
    Math,
    Promise,
    setTimeout: (fn) => setTimeout(fn, 0), // every pause is instant
    clearTimeout,
    ready: Promise.resolve(),
    ERRORS: { signIn: "E7006", securityCheck: "E7007", runTabClosed: "E7008", runFailed: "E7009" },
    state: { runs: [], jobs: {}, settings: { enabled: { linkedin: true } }, securityCheckDay: null, runAlert: null },
    persist: () => Promise.resolve(),
    updateBadge: () => {},
    flush: () => Promise.resolve(),
    localDay: (date = new Date()) => date.toISOString().slice(0, 10),
    visited: [],
    browser: {
      alarms: { create: (name, info) => alarms.set(name, info), clear: (name) => alarms.delete(name) },
      tabs: {
        onUpdated: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) },
        create: async () => {
          const id = nextTab++;
          tabs.set(id, { id, url: "about:blank" });
          return { id };
        },
        update: async (id, { url }) => {
          if (!tabs.has(id)) throw new Error("no tab");
          const tab = tabs.get(id);
          tab.url = redirect(url);
          context.visited.push(url);
          // A list page brings new jobs, as LinkedIn's data would.
          if (/\/jobs\/(collections\/recommended\/)?$/.test(url)) {
            const keys = [];
            for (let i = 0; i < jobsPerPage; i += 1) {
              jobNumber += 1;
              const key = `linkedin:${jobNumber}`;
              context.state.jobs[key] = { url: `https://www.linkedin.com/jobs/view/${jobNumber}`, level: "seen", closed: false };
              keys.push(key);
            }
            context.runSawJobs(id, keys, keys);
          }
          setTimeout(() => listeners.forEach((fn) => fn(id, { status: "complete" })), 0);
          return tab;
        },
        get: async (id) => {
          if (!tabs.has(id)) throw new Error("no tab");
          return tabs.get(id);
        },
        remove: async (id) => tabs.delete(id),
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  return { context, tabs, alarms };
}

function finished(context, id) {
  return new Promise((resolve) => {
    const check = () => {
      const run = context.state.runs.find((item) => item.id === id);
      if (run && !["scheduled", "running"].includes(run.status)) resolve(run);
      else setTimeout(check, 5);
    };
    check();
  });
}

test("a run reads the recommended pages and the watched companies' pages, opens up to 10 new jobs, closes its tab and is tagged Done", async () => {
  const { context, tabs, alarms } = sandbox({ jobsPerPage: 8 });
  const run = context.addRun(new Date(Date.now() + 3600000).toISOString());
  assert.strictEqual(run.status, "scheduled");
  assert.ok(alarms.has(`run:${run.id}`));
  await context.startRun(run.id);
  const done = await finished(context, run.id);
  assert.strictEqual(done.status, "done");
  assert.strictEqual(done.seen, 24);
  assert.strictEqual(done.fresh, 24);
  assert.strictEqual(done.opened, 10); // at most 10 opened per run
  assert.match(done.message, /24 jobs, 24 new, 10 opened/);
  assert.deepStrictEqual(context.visited.slice(0, 3), ["https://www.linkedin.com/jobs/", "https://www.linkedin.com/jobs/collections/recommended/",
    "https://www.linkedin.com/company/flywheel-digital/jobs/"]);
  assert.strictEqual(tabs.size, 0, "the run's tab was left open");
  assert.strictEqual(context.isRunTab(1), false);
});

test("a sign-in page stops the run (E7006) and leaves a warning", async () => {
  const { context } = sandbox({ redirect: () => "https://www.linkedin.com/login?session_redirect=jobs" });
  const run = context.addRun(new Date().toISOString());
  await context.startRun(run.id);
  const stopped = await finished(context, run.id);
  assert.strictEqual(stopped.status, "stopped");
  assert.strictEqual(stopped.code, "E7006");
  assert.strictEqual(context.state.runAlert.code, "E7006");
});

test("a security check stops the run (E7007) and no other run happens that day", async () => {
  const { context } = sandbox({ redirect: () => "https://www.linkedin.com/checkpoint/challenge/abc" });
  const first = context.addRun(new Date().toISOString());
  await context.startRun(first.id);
  assert.strictEqual((await finished(context, first.id)).code, "E7007");
  const second = context.addRun(new Date(Date.now() + 1000).toISOString());
  await context.startRun(second.id);
  const skipped = await finished(context, second.id);
  assert.strictEqual(skipped.status, "stopped");
  assert.match(skipped.message, /security check earlier today/);
  assert.strictEqual(context.visited.length, 1, "it went to LinkedIn again after a security check");
});

test("closing the run's tab stops it (E7008)", async () => {
  const { context, tabs } = sandbox();
  const run = context.addRun(new Date().toISOString());
  const going = context.startRun(run.id);
  await new Promise((resolve) => setTimeout(resolve, 1));
  context.runTabClosed(1);
  tabs.delete(1);
  await going;
  assert.strictEqual((await finished(context, run.id)).code, "E7008");
});

test("runs due while Firefox was closed: same day runs late, an earlier day is Missed, later ones stay scheduled", async () => {
  const { context, alarms } = sandbox();
  const now = Date.now();
  context.state.runs.push(
    { id: "today", when: new Date(now - 60000).toISOString(), status: "scheduled" },
    { id: "lastweek", when: new Date(now - 7 * 86400000).toISOString(), status: "scheduled" },
    { id: "later", when: new Date(now + 86400000).toISOString(), status: "scheduled" },
  );
  context.catchUpRuns();
  assert.strictEqual(context.state.runs.find((run) => run.id === "lastweek").status, "missed");
  assert.ok(alarms.has("run:later"));
  const late = await finished(context, "today");
  assert.strictEqual(late.status, "done");
  assert.strictEqual(late.late, true);
});

test("a time that has passed can't be scheduled", () => {
  const { context } = sandbox();
  assert.throws(() => context.addRun(new Date(Date.now() - 3600000).toISOString()), /already passed/);
  assert.throws(() => context.addRun("not a date"), /Pick a date/);
});

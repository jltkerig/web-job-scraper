// The daily check of Job Finder for a fresher profile (refreshProfile in background.js), with a stand-in Firefox and a
// stand-in Job Finder. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadBackground(answer) {
  const store = {};
  const asked = [];
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => Promise.resolve(undefined) });
  const browser = new Proxy({}, {
    get(_, name) {
      if (name === "storage") {
        return { local: { get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
          set: async (values) => Object.assign(store, values), remove: async () => {} }, onChanged: noop };
      }
      if (name === "runtime") return new Proxy({}, { get: (_, key) => key === "getURL" ? (file) => file : noop });
      return noop;
    },
  });
  const context = vm.createContext({ browser, console, URL, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    AbortController, fetch: async (url, options) => { asked.push(url); return answer(url, options); } });
  for (const file of ["sites/linkedin-parse.js", "sites/mwe-parse.js", "sites/usajobs-parse.js", "sites/sample-only.js", "background.js", "runs.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"), context, { filename: file });
  }
  return { context, store, asked };
}

const profile = { source: "job-finder", kind: "fit-profile", titles: ["Web Designer", "UX Designer"], skills: ["HTML"],
  work_preferences: [], blocked_companies: [], skill_aliases: {}, ambiguous_skills: [], home: { zip: "17101", state: "MD", lat: 40.3, lon: -76.9 } };
const jobFinder = (data) => async () => ({ ok: true, status: 200, json: async () => data });

test("the profile is read from Job Finder on this computer and kept", async () => {
  const { context, store, asked } = loadBackground(jobFinder(profile));
  await context.ready;
  const reply = await context.refreshProfile(true);
  assert.deepStrictEqual({ ...reply }, { ok: true, titles: 2, skills: 1 });
  assert.strictEqual(store.fitProfile.home.zip, "17101");
  assert.ok(store.profileCheckedAt);
  assert.strictEqual(store.profileCheckError, "");
  assert.ok(asked.every((url) => url === "http://127.0.0.1:5000/extension/profile-file"));
});

test("a profile checked within a day is not asked for again, and Check now always asks", async () => {
  const { context, asked } = loadBackground(jobFinder(profile));
  await context.ready;
  await context.refreshProfile(true);
  const before = asked.length;
  assert.strictEqual((await context.refreshProfile()).skipped, true);
  assert.strictEqual(asked.length, before);
  await context.refreshProfile(true);
  assert.strictEqual(asked.length, before + 1);
});

test("a check that is a day old asks again", async () => {
  const { context, store, asked } = loadBackground(jobFinder(profile));
  await context.ready;
  await context.refreshProfile(true);
  store.profileCheckedAt = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  const before = asked.length;
  await context.refreshProfile();
  assert.strictEqual(asked.length, before + 1);
});

test("Job Finder not running keeps the profile already saved and says so", async () => {
  const down = async () => { throw new TypeError("NetworkError when attempting to fetch resource."); };
  const { context, store } = loadBackground(down);
  await context.ready;
  await context.loadProfileFile(profile); // from a file earlier
  const reply = await context.refreshProfile(true);
  assert.strictEqual(reply.ok, false);
  assert.strictEqual(store.fitProfile.titles.length, 2);
  assert.match(store.profileCheckError, /isn't open on this computer.*every hour/);
  assert.ok(!store.profileCheckedAt); // so the next hourly check tries again
});

test("something that is not a Job Finder profile is refused", async () => {
  const { context, store } = loadBackground(jobFinder({ hello: "world" }));
  await context.ready;
  const reply = await context.refreshProfile(true);
  assert.strictEqual(reply.ok, false);
  assert.match(store.profileCheckError, /isn't a Job Finder profile/);
  assert.ok(!store.fitProfile);
});

test("with the daily check switched off, Job Finder is never asked", async () => {
  const { context, store, asked } = loadBackground(jobFinder(profile));
  await context.ready;
  store.profileAuto = false;
  asked.length = 0;
  assert.strictEqual((await context.refreshProfile(true)).skipped, true);
  assert.strictEqual(asked.length, 0);
});

test("the jobs waiting in Needs a look are those with no location that were never opened", async () => {
  const { context } = loadBackground(jobFinder(profile));
  await context.ready;
  vm.runInContext(`
    state.jobs = {
      "linkedin:1": { site: "linkedin", job_id: "1", title: "A", location: "", level: "seen", last_seen: "2026-10-14T10:00:00Z" },
      "linkedin:2": { site: "linkedin", job_id: "2", title: "B", location: "Harrisburg, PA", level: "seen", last_seen: "2026-10-14T10:00:00Z" },
      "linkedin:3": { site: "linkedin", job_id: "3", title: "C", location: "", level: "opened", last_seen: "2026-10-14T10:00:00Z" },
    };`, context);
  assert.strictEqual((await context.popupState()).needsLookTotal, 1);
});

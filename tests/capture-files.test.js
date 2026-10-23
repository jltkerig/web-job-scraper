// Each save writes its own file holding only the jobs that are new or changed since the last one, so Job Finder
// imports every scrape once (and a file that was imported is never written again).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadBackground() {
  const store = {};
  const written = []; // { filename, body }
  const listeners = [];
  const blobs = new Map();
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => Promise.resolve(undefined) });
  const downloads = {
    onChanged: { addListener: (fn) => listeners.push(fn), removeListener: () => {} },
    erase: async () => {},
    download: async ({ url, filename }) => {
      const blob = blobs.get(url);
      written.push({ filename, text: blob.text() });
      setImmediate(() => listeners.forEach((fn) => fn({ id: 1, state: { current: "complete" } })));
      return 1;
    },
  };
  const browser = new Proxy({}, {
    get(_, name) {
      if (name === "downloads") return downloads;
      if (name === "storage") {
        return { local: { get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
          set: async (values) => Object.assign(store, values), remove: async () => {} }, onChanged: noop };
      }
      if (name === "runtime") return new Proxy({}, { get: (_, key) => key === "getManifest" ? () => ({ version: "9.9.9" }) : key === "getURL" ? (f) => f : noop });
      return noop;
    },
  });
  let counter = 0;
  const URLStub = { createObjectURL: (blob) => { const url = `blob:test-${counter++}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} };
  const context = vm.createContext({ browser, console, URL: URLStub, Blob, setTimeout, clearTimeout, setInterval, clearInterval,
    setImmediate, Date, Math, JSON, fetch: async () => ({ json: async () => ({}) }) });
  for (const file of ["sites/linkedin-parse.js", "sites/mwe-parse.js", "sites/usajobs-parse.js", "sites/sample-only.js", "background.js", "runs.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"), context, { filename: file });
  }
  return { context, written };
}

// A job changed in the same millisecond a file starts is written again next time (a harmless repeat, never a loss),
// so the test keeps changes and saves a few milliseconds apart.
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

const job = (id, title = "Web Designer") => ({ site: "linkedin", job_id: String(id), url: `https://www.linkedin.com/jobs/view/${id}`,
  title, company: "Acme", location: "Austin, TX", level: "seen", page_kind: "search" });

test("every save is its own file with only what is new or changed since the last one", async () => {
  const { context, written } = loadBackground();
  await vm.runInContext("ready", context); // storage is read once at start
  context.addJobs("linkedin", [job(1), job(2)]);
  await pause();
  await context.flush(true);
  await pause();
  context.addJobs("linkedin", [job(2), job(3)]); // job 2 was only seen again; job 3 is new
  await pause();
  await context.flush(true);
  await pause();
  context.addJobs("linkedin", [job(1, "Senior Web Designer")]); // a changed title counts as changed
  await pause();
  await context.flush(true);
  await context.flush(true); // nothing changed: no file

  assert.strictEqual(written.length, 3);
  const names = written.map((item) => item.filename);
  assert.strictEqual(new Set(names).size, 3, "no two saves share a file");
  for (const name of names) assert.match(name, /searches\/passive-\d\d-\d\d-\d{4}-\d\d\.\d\d\.\d\d\.\d{3}\/linkedin\/jobs\.json$/);
  const jobsIn = async (item) => JSON.parse(await item.text).jobs.map((saved) => saved.job_id).sort();
  assert.deepStrictEqual(await jobsIn(written[0]), ["1", "2"]);
  assert.deepStrictEqual(await jobsIn(written[1]), ["3"]);
  assert.deepStrictEqual(await jobsIn(written[2]), ["1"]);
  assert.ok(!("changed_at" in JSON.parse(await written[0].text).jobs[0]));
});

test("a list card that says the job is closed marks it closed, and the next file carries it", async () => {
  const { context, written } = loadBackground();
  await vm.runInContext("ready", context);
  context.addJobs("linkedin", [job(1)]);
  await pause();
  await context.flush(true);
  await pause();
  context.addJobs("linkedin", [{ ...job(1), closed: true }]); // seen again in a search list, now "No longer accepting applications"
  await pause();
  await context.flush(true);

  assert.strictEqual(written.length, 2);
  const [saved] = JSON.parse(await written[1].text).jobs;
  assert.strictEqual(saved.job_id, "1");
  assert.strictEqual(saved.closed, true);
});

const savedJob = (id, total) => ({ ...job(id), page_kind: "tracker", saved: true, saved_total: total });

test("a Saved jobs list read in full un-saves the saved job it no longer lists, and the next file says so", async () => {
  const { context, written } = loadBackground();
  await vm.runInContext("ready", context);
  context.addJobs("linkedin", [savedJob(1, 3), savedJob(2, 3), savedJob(3, 3)]);
  await pause();
  await context.flush(true);
  await pause();
  context.addJobs("linkedin", [savedJob(1, 2), savedJob(2, 2)]); // "Saved · 2" and both cards read: job 3 is no longer saved
  await pause();
  await context.flush(true);

  const [, second] = written;
  const byId = Object.fromEntries(JSON.parse(await second.text).jobs.map((saved) => [saved.job_id, saved]));
  assert.strictEqual(byId["3"].saved, false);
  assert.strictEqual(byId["1"], undefined, "jobs still saved are not rewritten");
});

test("a Saved jobs list that is only partly read un-saves nothing", async () => {
  const { context, written } = loadBackground();
  await vm.runInContext("ready", context);
  context.addJobs("linkedin", [savedJob(1, 3), savedJob(2, 3), savedJob(3, 3)]);
  await pause();
  await context.flush(true);
  await pause();
  context.addJobs("linkedin", [savedJob(1, 3)]); // the box says 3, only one card was read (the list is still loading)
  await pause();
  await context.flush(true);
  await context.flush(true);

  assert.strictEqual(written.length, 1);
});

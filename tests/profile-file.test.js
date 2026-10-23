// The extension on its own: a profile file exported by Job Finder is loaded, and distances are worked out here,
// matching Job Finder's own estimate (the numbers below come from its places.php for the same places).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const fixture = require("./home-fixture.js");

// background.js with a stand-in browser: every API is a do-nothing function, storage is a plain object.
function loadBackground() {
  const store = {};
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => Promise.resolve(undefined) });
  const browser = new Proxy({}, {
    get(_, name) {
      if (name === "storage") {
        return { local: { get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
          set: async (values) => Object.assign(store, values), remove: async () => {} }, onChanged: noop };
      }
      if (name === "runtime") {
        return new Proxy({}, { get: (_, key) => key === "getURL" ? (file) => file : noop });
      }
      return noop;
    },
  });
  const places = JSON.parse(fs.readFileSync(path.join(__dirname, "../extension/data/us-places.json"), "utf8"));
  const context = vm.createContext({ browser, console, URL, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    fetch: async () => ({ json: async () => places }) });
  for (const file of ["sites/linkedin-parse.js", "sites/mwe-parse.js", "sites/usajobs-parse.js", "sites/sample-only.js", "background.js", "runs.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"), context, { filename: file });
  }
  return { context, store };
}

const profile = { source: "job-finder", kind: "fit-profile", titles: ["Web Designer"], skills: ["HTML", "CSS"], work_preferences: [],
  blocked_companies: [], skill_aliases: {}, ambiguous_skills: [], home: fixture.home };

test("a profile file is checked before it is kept", async () => {
  const { context, store } = loadBackground();
  assert.strictEqual((await context.loadProfileFile({ titles: ["x"] })).ok, false);
  const reply = await context.loadProfileFile(profile);
  assert.deepStrictEqual({ ...reply }, { ok: true, titles: 1, skills: 2 });
  assert.strictEqual(store.fitProfile.home.zip, fixture.home.zip);
});

test("distances match Job Finder's estimate", async () => {
  const { context } = loadBackground();
  await context.loadProfileFile(profile);
  const places = [fixture.place, "Towson, Maryland, United States", "Lancaster", "Greater Baltimore Area", "Austin, TX (Hybrid)",
    "Nowhereville, ZZ"];
  const reply = await context.distancesFor(places);
  assert.deepStrictEqual(places.map((place) => reply.places[place] && reply.places[place].text), fixture.distances);
});

test("without a home, distances say what to do", async () => {
  const { context, store } = loadBackground();
  await context.loadProfileFile({ ...profile, home: { zip: "", state: "", lat: null, lon: null } });
  assert.deepStrictEqual({ ...(await context.distancesFor([fixture.place])).places }, {});
  assert.match(store.distanceError, /Home ZIP/);
});

test("the only thing it asks Job Finder for is the profile, and the manifest names Job Finder's address so Firefox does not ask about local network access", () => {
  const manifest = fs.readFileSync(path.join(__dirname, "../extension/manifest.json"), "utf8");
  const background = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");
  assert.deepStrictEqual(manifest.match(/127\.0\.0\.1[^"]*/g), ["127.0.0.1/*"]); // named so Firefox does not ask about "access to other apps and services on this device"
  assert.deepStrictEqual(background.match(/127\.0\.0\.1[^"'`]*/g), ["127.0.0.1:5000/extension/profile-file"]);
});

// The Job Finder page script that passes the profile and distances to the extension. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");

function page(fetchImpl) {
  const window = new JSDOM("<body></body>", { url: "http://127.0.0.1:5000/", runScripts: "outside-only" }).window;
  const sent = [];
  let listener = null;
  window.browser = { runtime: { onMessage: { addListener: (fn) => { listener = fn; } }, sendMessage: async (message) => { sent.push(message); } } };
  window.fetch = fetchImpl;
  window.eval(require("node:fs").readFileSync(require.resolve("../extension/content/jf-bridge.js"), "utf8"));
  return { window, sent, ask: (message) => listener(message) };
}
const json = (data) => async () => ({ ok: true, status: 200, json: async () => data });

test("it hands the fit profile to the extension when a Job Finder page opens", async () => {
  const { window, sent } = page(json({ titles: ["Web Designer"] }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(JSON.stringify(sent), JSON.stringify([{ type: "fit-profile-push", profile: { titles: ["Web Designer"] } }]));
  window.close();
});

test("it answers the extension's two read-only requests and nothing else", async () => {
  const paths = [];
  const { window, ask } = page(async (path) => { paths.push(path); return { ok: true, status: 200, json: async () => ({ places: {} }) }; });
  assert.strictEqual(JSON.stringify(await ask({ type: "jf-fetch", path: "/extension/distances?places=Towson" })), JSON.stringify({ ok: true, data: { places: {} } }));
  assert.strictEqual(ask({ type: "jf-fetch", path: "/dashboard" }), undefined); // not a page it passes on
  assert.strictEqual(ask({ type: "jf-fetch", path: "//evil.example/extension/fit-profile" }), undefined);
  assert.strictEqual(ask({ type: "other" }), undefined);
  assert.ok(!paths.includes("/dashboard"));
  window.close();
});

test("a failed read is reported, not thrown", async () => {
  const { window, ask } = page(async () => { throw new Error("offline"); });
  assert.strictEqual(JSON.stringify(await ask({ type: "jf-fetch", path: "/extension/fit-profile" })), JSON.stringify({ ok: false, error: "offline" }));
  window.close();
});

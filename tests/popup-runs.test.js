// The panel puts each website's runs under its name (popup.js), with a stand-in Firefox. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const POPUP = path.join(__dirname, "..", "extension", "popup");

const windows = [];

test.after(() => windows.forEach((window) => window.close())); // stops the panel's refresh timer

async function open(runs = [], runAlert = null) {
  const sent = [];
  const site = (name) => ({ name, enabled: true, seen: 0, opened: 0, fresh: 0, lastSave: null, unsaved: false, broken: null, noDetails: null, error: null });
  const state = { sites: { linkedin: site("LinkedIn"), mwe: site("Maryland Workforce Exchange"), usajobs: site("USAJOBS"), jobaps: site("State of Maryland Jobs") },
    needsLook: [], needsLookTotal: 0, pet: { enabled: false, speed: 1, size: 1 }, garden: 0, runs, runAlert, autoSample: true };
  const html = fs.readFileSync(path.join(POPUP, "popup.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "moz-extension://x/popup/popup.html" });
  const { window } = dom;
  windows.push(window);
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {}, set: () => true }); // the fox garden
  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  window.browser = {
    runtime: { sendMessage: async (payload) => { sent.push(payload); return state; }, getManifest: () => ({ version: "0" }) },
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { create: async () => {}, query: async () => [] },
  };
  for (const file of ["../pet/sprites.js", "../pet/pet.js", "popup.js"]) window.eval(fs.readFileSync(path.join(POPUP, file), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { window, sent };
}

test("every website has its own run buttons under its name, and the old runs section is gone", async () => {
  const { window } = await open();
  const cards = [...window.document.querySelectorAll("#sites .site")];
  assert.strictEqual(cards.length, 4);
  for (const card of cards) {
    const labels = [...card.querySelectorAll(".run-add button")].map((button) => button.textContent);
    assert.deepStrictEqual(labels, ["Add", "Run now"]);
    assert.ok(card.querySelector(".run-add input[type=datetime-local]"));
  }
  assert.strictEqual(window.document.querySelector("section.runs"), null);
  assert.strictEqual(window.document.getElementById("run-now"), null);
});

test("Run now on a site asks for a run on that site", async () => {
  const { window, sent } = await open();
  const mweCard = [...window.document.querySelectorAll("#sites .site")][1];
  mweCard.querySelectorAll(".run-add button")[1].click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const asked = sent.find((message) => message.type === "run-now");
  assert.strictEqual(asked.site, "mwe");
});

test("runs and alerts are listed under the site they belong to (older runs count as LinkedIn)", async () => {
  const when = new Date(Date.now() + 3600000).toISOString();
  const runs = [{ id: "a", when, status: "scheduled" }, { id: "b", site: "mwe", when, status: "done", message: "30 jobs, 4 new, 3 more pages read" }];
  const { window } = await open(runs, { code: "E7009", message: "Open your search first", site: "mwe" });
  const [linkedin, mwe, usajobs] = [...window.document.querySelectorAll("#sites .site")];
  assert.strictEqual(linkedin.querySelectorAll(".run-list li .tag").length, 1);
  assert.match(mwe.querySelector(".run-list").textContent, /3 more pages read/);
  assert.match(usajobs.querySelector(".run-list").textContent, /No runs scheduled/);
  assert.match(mwe.querySelector(".run-alert").textContent, /E7009/);
  assert.strictEqual(linkedin.querySelector(".run-alert").hidden, true);
});

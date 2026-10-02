// The fox strip on a LinkedIn jobs page: minimizing to a badge and back. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// Every test page is closed at the end, which stops the strip's timers so the test run can finish.
const pages = [];
test.after(() => pages.forEach((page) => page.close()));

const read = (file) => fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8");

// A LinkedIn jobs page with the extension's content scripts and a stand-in for the browser APIs.
async function stripPage({ minimized = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://www.linkedin.com/jobs/search-results/?keywords=designer", runScripts: "outside-only", pretendToBeVisual: true,
  });
  const { window } = dom;
  const stored = { petMinimized: minimized };
  const storageListeners = [];
  window.browser = {
    runtime: {
      sendMessage: async () => ({ pet: { enabled: true, speed: "normal", sites: { linkedin: true } }, garden: [{ key: "linkedin:1", title: "Web Designer" }] }),
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        get: async () => ({ ...stored }),
        set: async (values) => {
          Object.assign(stored, values);
          for (const listener of storageListeners) listener({ petMinimized: { newValue: values.petMinimized } }, "local");
        },
      },
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
  };
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLCanvasElement.prototype.getContext = () => ({
    setTransform() {}, clearRect() {}, fillRect() {}, fillText() {}, imageSmoothingEnabled: false, globalAlpha: 1,
  });
  const attach = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function open() { return attach.call(this, { mode: "open" }); }; // for the test
  for (const file of ["pet/sprites.js", "pet/pet.js", "content/pet-strip.js"]) window.eval(read(file));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const host = [...window.document.documentElement.children].find((node) => node.shadowRoot);
  pages.push(window);
  return { window, host, root: host && host.shadowRoot, stored };
}

test("the strip runs along the bottom with a minimize button", async () => {
  const { host, root } = await stripPage();
  assert.ok(host, "no strip on the jobs page");
  assert.match(host.style.cssText, /left: 0px/);
  assert.strictEqual(root.querySelector(".minimize").hidden, false);
  assert.strictEqual(root.querySelector(".badge").hidden, true);
});

test("minimizing shrinks it to a badge, remembers it, and the badge brings it back", async () => {
  const { host, root, stored } = await stripPage();
  root.querySelector(".minimize").click();
  assert.strictEqual(stored.petMinimized, true);
  assert.match(host.style.cssText, /width: 48px/);
  assert.strictEqual(root.querySelector("canvas.strip").hidden, true);
  assert.strictEqual(root.querySelector(".badge").hidden, false);

  root.querySelector(".badge").click();
  assert.strictEqual(stored.petMinimized, false);
  assert.match(host.style.cssText, /left: 0px/);
  assert.strictEqual(root.querySelector("canvas.strip").hidden, false);
});

test("if the page's redraw throws the strip out, it comes back", async () => {
  const { window, host } = await stripPage();
  assert.strictEqual(host.parentNode, window.document.documentElement); // outside the body LinkedIn redraws
  host.remove();
  assert.strictEqual(host.isConnected, false);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.strictEqual(host.isConnected, true);
});

test("a page that briefly reports no width keeps a usable strip", async () => {
  const { window } = await stripPage();
  Object.defineProperty(window.document.documentElement, "clientWidth", { configurable: true, get: () => 0 });
  window.dispatchEvent(new window.Event("resize"));
  await new Promise((resolve) => setTimeout(resolve, 200));
  const canvas = [...window.document.documentElement.children].find((node) => node.shadowRoot).shadowRoot.querySelector("canvas.strip");
  assert.ok(parseFloat(canvas.style.width) >= 320, `strip width ${canvas.style.width}`);
});

test("a page opened while minimized starts as the badge", async () => {
  const { host, root } = await stripPage({ minimized: true });
  assert.match(host.style.cssText, /width: 48px/);
  assert.strictEqual(root.querySelector(".badge").hidden, false);
});

test("a second copy of the script (after an extension update) leaves only one fox on the page", async () => {
  const { window } = await stripPage();
  const hosts = () => [...window.document.documentElement.children].filter((node) => node.shadowRoot);
  assert.strictEqual(hosts().length, 1);
  window.eval(read("content/pet-strip.js")); // the page kept the old copy running, and the new one starts beside it
  await new Promise((resolve) => setTimeout(resolve, 1300)); // the older copy checks once a second
  assert.strictEqual(hosts().length, 1, "two foxes on the page");
});

test("a fox left by an older version of the script (which can't retire itself) is hidden, ours is not", async () => {
  const { window, host } = await stripPage();
  const old = window.document.createElement("div");
  old.style.cssText = "position:fixed;z-index:2147483000;pointer-events:none;left:0;right:0;bottom:0;height:128px;";
  window.document.documentElement.appendChild(old);
  assert.strictEqual(window.getComputedStyle(old).display, "none");
  assert.notStrictEqual(window.getComputedStyle(host).display, "none");
  assert.strictEqual(window.document.querySelectorAll("#wjs-fox-cleanup").length, 1);
});

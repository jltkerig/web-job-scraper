// "Save this page for fixing" on a page the extension doesn't run on (Google, any page). Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const CODE = fs.readFileSync(require.resolve("../extension/content/page-copy.js"), "utf8");
const URL_OPEN = "https://www.google.com/search?q=graphic+designer+jobs&ibp=htl;jobs";

function run(html) {
  const dom = new JSDOM(html, { url: URL_OPEN, runScripts: "outside-only" });
  const result = dom.window.eval(CODE);
  dom.window.close();
  return result;
}

test("the copy returns the address and the page without scripts or typed-in text", () => {
  const { url, html } = run(`<html><body><div id="jobs"><h2>Graphic Designer</h2><span>Acme · Baltimore, MD</span></div>
    <input name="q" value="my secret search"><textarea>private note</textarea>
    <script>window.me = "Jamie"</script><noscript>turn on scripts</noscript><template><p>hidden</p></template></body></html>`);
  assert.strictEqual(url, URL_OPEN);
  assert.doesNotMatch(html, /my secret search|private note|window\.me|turn on scripts|hidden/);
  assert.match(html, /<h2>Graphic Designer<\/h2>/);
  assert.match(html, /Acme · Baltimore, MD/);
  assert.match(html, /<input name="q">/);
});

test("the page itself is left as it was", () => {
  const dom = new JSDOM(`<html><body><input value="kept"><script>1</script></body></html>`, { url: URL_OPEN, runScripts: "outside-only" });
  dom.window.eval(CODE);
  assert.strictEqual(dom.window.document.querySelector("input").getAttribute("value"), "kept");
  assert.strictEqual(dom.window.document.querySelectorAll("script").length, 1);
  dom.window.close();
});

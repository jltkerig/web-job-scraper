// Marking LinkedIn jobs that may fit: title matching, Job Fit, and the page markers.
// Run with: npm install, then npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/linkedin-parse.js");
require("../extension/sites/linkedin-fit.js");

const fit = globalThis.LinkedInFit;
const TITLES = ["Web Designer", "graphic design", "Production Specialist", "content designer"];

test("title fit: good when every word of a title is there, word forms count", () => {
  for (const title of ["Senior Web Designer II", "Graphic Designer", "Website Designer", "Production Specialist - Print"]) {
    assert.strictEqual(fit.titleFit(title, TITLES).level, "good", title);
  }
});

test("title fit: maybe when half a title matches, nothing otherwise", () => {
  assert.strictEqual(fit.titleFit("Content Strategist", TITLES).level, "maybe");
  assert.strictEqual(fit.titleFit("Registered Nurse", TITLES).level, "");
  assert.strictEqual(fit.titleFit("Anything", []).level, "");
});

test("work location: only a clear mismatch with your choices rules a job out", () => {
  assert.ok(fit.arrangementFits("Remote", ["Remote", "Hybrid"]));
  assert.ok(!fit.arrangementFits("On-site", ["Remote"]));
  assert.ok(fit.arrangementFits("", ["Remote"])); // unknown: keep
  assert.ok(fit.arrangementFits("On-site", ["Full-time"])); // no location choices made
});

test("skills and Job Fit like the Dashboard, with everyday words handled carefully", () => {
  const aliases = { HTML: ["html", "html5"], CSS: ["css"], React: ["react", "reactjs"], Figma: ["figma"] };
  const text = "We need HTML5 and CSS skills, Figma a plus. You will react quickly to feedback.";
  const skills = fit.detectSkills(text, aliases, ["React"]);
  assert.deepStrictEqual(skills, ["HTML", "CSS", "Figma"]);
  assert.deepStrictEqual(fit.jobFit(["HTML", "CSS"], skills), { score: 67, matched: ["HTML", "CSS"], missing: ["Figma"] });
  assert.strictEqual(fit.jobFit(["HTML"], []).score, null);
});

test("card fit gives one reason line, or nothing", () => {
  const profile = { titles: TITLES, work_preferences: [] };
  assert.match(fit.cardFit({ title: "Graphic Designer", work_arrangement: "Hybrid" }, profile).reason, /graphic design.*Hybrid/);
  assert.strictEqual(fit.cardFit({ title: "Nurse" }, profile), null);
  assert.strictEqual(fit.cardFit({ title: "Graphic Designer" }, null), null);
});

const LIST = `<!doctype html><html><body><main>
  <a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4400000011"><p>Graphic Designer</p><p>Acme</p><p>Baltimore, MD (Hybrid)</p></a>
  <a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4400000012"><p>Registered Nurse</p><p>Hospital</p><p>Towson, MD</p></a>
  <div><div><h2>About the job</h2></div><div style="max-height: 60px; overflow: hidden">
    <p>${"We build pages with HTML and CSS every day and review designs in Figma. ".repeat(5)}</p>
    <button>… more</button></div></div>
</main></body></html>`;

test("the page: fitting cards are highlighted, the description opens, the badge is invisible to capture", async () => {
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4400000011";
  const dom = new JSDOM(LIST, { url, pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  const stored = { fitProfile: { titles: TITLES, skills: ["HTML", "CSS"], work_preferences: [],
    skill_aliases: { HTML: ["html"], CSS: ["css"], Figma: ["figma"] }, ambiguous_skills: [] } };
  window.browser = { storage: { local: { get: async () => stored }, onChanged: { addListener() {} } } };
  window.LinkedInParse = globalThis.LinkedInParse;
  window.LinkedInFit = globalThis.LinkedInFit;
  const before = JSON.stringify(globalThis.LinkedInParse.fromDom(window.document, url));
  window.eval(require("node:fs").readFileSync(require.resolve("../extension/content/fit-marks.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 900));

  const [designer, nurse] = window.document.querySelectorAll("a");
  assert.match(designer.getAttribute("data-wjs-fit"), /graphic design/);
  assert.strictEqual(nurse.getAttribute("data-wjs-fit"), null);
  const clamp = window.document.querySelector("div[style]");
  assert.strictEqual(clamp.style.getPropertyValue("max-height"), "none");
  assert.strictEqual(window.document.querySelector("button").style.display, "none");
  const badge = window.document.querySelector("wjs-fit-tag[data-detail]");
  assert.match(badge.dataset.label, /Job Fit 67%/);

  // The capture code reads the page's text: the markers must not change what it saves.
  const after = JSON.stringify(globalThis.LinkedInParse.fromDom(window.document, url));
  assert.strictEqual(after, before);
  assert.ok(!/Job Fit|"Fit"/.test(after));
  window.close();
});

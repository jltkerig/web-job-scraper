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
  assert.strictEqual(fit.titleFit("Production Designer", TITLES).level, "maybe"); // shares the job word "designer"
  assert.strictEqual(fit.titleFit("Content Strategist", TITLES).level, ""); // shares only "content", not the job word
  assert.strictEqual(fit.titleFit("Web Content Specialist", ["content designer"]).level, "");
  // A common job word ("specialist") proves nothing on its own: the descriptive word has to match too.
  assert.strictEqual(fit.titleFit("Marketing Specialist", ["production specialist"]).level, "");
  assert.strictEqual(fit.titleFit("Digital Content Specialist", ["production specialist"]).level, "");
  assert.strictEqual(fit.titleFit("Digital Production Manager", ["production specialist"]).level, "maybe");
  assert.strictEqual(fit.titleFit("Web Developer II", ["frontend web developer"]).level, "maybe");
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

test("a company's own jobs page counts as a jobs page, so its jobs are captured", () => {
  const parse = globalThis.LinkedInParse;
  const page = "https://www.linkedin.com/company/flywheel-digital/jobs/";
  assert.ok(parse.onJobsPage(new URL(page)));
  assert.ok(parse.expectsJobs(page));
  assert.ok(!parse.onJobsPage(new URL("https://www.linkedin.com/company/flywheel-digital/people/")));
  const html = `<main><a href="https://www.linkedin.com/jobs/view/4400000099/"><p>Web Designer</p><p>Flywheel</p><p>Remote</p></a></main>`;
  const jobs = parse.fromDom(new JSDOM(html, { url: page }).window.document, page);
  assert.strictEqual(jobs[0].company, "Flywheel");
});

test("Indeed and USAJOBS are sample-only: no jobs are read, pages report in so samples can be kept", () => {
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(require.resolve("../extension/manifest.json"), "utf8"));
  const entry = manifest.content_scripts.find((item) => item.matches.some((m) => m.includes("indeed.com")));
  assert.ok(entry.matches.includes("https://www.usajobs.gov/*"));
  assert.deepStrictEqual(entry.js, ["sites/sample-only.js", "content/capture.js"]);
  assert.ok(manifest.background.scripts.indexOf("sites/sample-only.js") < manifest.background.scripts.indexOf("background.js"));
  require("../extension/sites/sample-only.js");
  const sample = globalThis.SampleParse;
  assert.strictEqual(sample.onJobsPage(new URL("https://www.indeed.com/jobs?q=web")), true); // every page reports in, so a sample can be kept
  assert.strictEqual(sample.expectsJobs("https://www.indeed.com/jobs?q=web"), false);
  assert.deepStrictEqual(sample.fromDom({}, "https://www.indeed.com/"), []);
});

const CARDS = `<!doctype html><html><body><main><ul id="list">
  <li><div class="w"><a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4400000021"><p>Web Designer</p><p>Far Co</p><p>Lancaster, PA</p></a></div></li>
  <li><div class="w"><a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4400000022"><p>Web Designer</p><p>Mystery Co</p><p>Nowhereville, ZZ</p></a></div></li>
  <li><div class="w"><a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4400000023"><p>Web Designer</p><p>Near Co</p><p>Bel Air, MD</p></a></div></li>
  <li><div class="w"><a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4400000024"><p>Web Designer</p><p>Mid Co</p><p>Towson, MD</p></a></div></li>
</ul></main></body></html>`;

function cardsPage(sortByDistance) {
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4400000021";
  const window = new JSDOM(CARDS, { url, pretendToBeVisual: true, runScripts: "outside-only" }).window;
  const answers = { "Lancaster, PA": { minutes: 75, text: "39 mi · ~75 min" }, "Bel Air, MD": { minutes: 15, text: "5 mi · ~15 min" },
    "Towson, MD": { minutes: 45, text: "19 mi · ~45 min" }, "Nowhereville, ZZ": null };
  const asked = [];
  window.browser = { runtime: { sendMessage: async (message) => { asked.push(message); return { places: answers }; } },
    storage: { local: { get: async () => ({ fitProfile: { titles: ["Web Designer"], skills: [], work_preferences: [] }, sortByDistance }),
      }, onChanged: { addListener() {} } } };
  window.LinkedInParse = globalThis.LinkedInParse;
  window.LinkedInFit = globalThis.LinkedInFit;
  window.eval(require("node:fs").readFileSync(require.resolve("../extension/content/fit-marks.js"), "utf8"));
  return { window, asked };
}

test("every card shows its estimated drive and the list goes nearest first, unknown last", async () => {
  const { window, asked } = cardsPage(true);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepStrictEqual([...asked[0].places].sort(), ["Bel Air, MD", "Lancaster, PA", "Nowhereville, ZZ", "Towson, MD"]);
  const order = Array.from(window.document.querySelectorAll("#list > li"), (li) => [li.querySelector("p:nth-child(2)").textContent, Number(li.style.order)]);
  const byOrder = order.slice().sort((a, b) => a[1] - b[1]).map(([name]) => name);
  assert.deepStrictEqual(byOrder, ["Near Co", "Mid Co", "Far Co", "Mystery Co"]);
  const labels = Array.from(window.document.querySelectorAll("wjs-fit-tag[data-distance]"), (tag) => tag.dataset.label).sort();
  assert.deepStrictEqual(labels, ["19 mi · ~45 min", "39 mi · ~75 min", "5 mi · ~15 min"]); // none for the unknown town
  assert.strictEqual(window.document.querySelector("#list").style.getPropertyValue("flex-direction"), "column");
  window.close();
});

test("with the panel's checkbox off, distances are shown but nothing is reordered", async () => {
  const { window } = cardsPage(false);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.strictEqual(window.document.querySelectorAll("wjs-fit-tag[data-distance]").length, 3);
  assert.ok(Array.from(window.document.querySelectorAll("#list > li")).every((li) => li.style.order === ""));
  window.close();
});

test("a sentence with a comma is not read as a place (', we' is not a state code)", () => {
  const parse = globalThis.LinkedInParse;
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4400000031";
  const html = `<main>
    <a href="${url}"><p>Web Designer</p><p>Promo Co</p><p>Last week, we challenged what we do. This week, we challenged how we do it.</p></a>
    <a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4400000032"><p>Web Designer</p><p>Real Co</p><p>Bel Air, MD</p></a>
  </main>`;
  const jobs = Object.fromEntries(parse.cards(new JSDOM(html, { url }).window.document, url).map(({ job }) => [job.job_id, job]));
  assert.strictEqual(jobs["4400000031"].location, "");
  assert.strictEqual(jobs["4400000032"].location, "Bel Air, MD");
});

test("when distances can't be read, the same places aren't asked again every second", async () => {
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4400000021";
  const window = new JSDOM(CARDS, { url, pretendToBeVisual: true, runScripts: "outside-only" }).window;
  let calls = 0;
  window.browser = { runtime: { sendMessage: async () => { calls += 1; return { places: {}, error: "blocked" }; } },
    storage: { local: { get: async () => ({ fitProfile: { titles: ["Web Designer"], skills: [], work_preferences: [] } }),
      }, onChanged: { addListener() {} } } };
  window.LinkedInParse = globalThis.LinkedInParse;
  window.LinkedInFit = globalThis.LinkedInFit;
  window.eval(require("node:fs").readFileSync(require.resolve("../extension/content/fit-marks.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 900));
  window.document.body.appendChild(window.document.createElement("div")); // the page changes: another look
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.strictEqual(calls, 1);
  window.close();
});

// Shaped like the real 2026 search page saved from LinkedIn: a "lazy column" of blocks with spacers between, each
// card a clickable block tagged job-card-component-ref-<id> with no link inside, led by an accessible repeat of the title.
const REAL = `<!doctype html><html><body><main><div data-testid="lazy-column" id="column">
  <div><p>Jobs based on your preferences</p><p>99+ results</p></div>
  <div data-display-contents="true"><div><div data-display-contents="true"><div role="button" tabindex="0" componentkey="job-card-component-ref-4466104575">
    <div componentkey="job-card-component-ref-4466104575"><p>Graphic Designer (Verified job)</p><p>Graphic Designer</p><p>GemHarvest Executive Recruiting</p><p>Baltimore, MD (On-site)</p><p>$90K/yr - $110K/yr</p></div></div></div></div></div>
  <div></div>
  <div data-display-contents="true"><div><div data-display-contents="true"><div role="button" tabindex="0" componentkey="job-card-component-ref-4460751737">
    <div componentkey="job-card-component-ref-4460751737"><p>Selected, Graphic Designer</p><p>Graphic Designer</p><p>Kidde Global Solutions</p><p>United States (Remote)</p><p>401(k)</p></div></div></div></div></div>
  <div></div>
  <div data-display-contents="true"><div><div data-display-contents="true"><div role="button" tabindex="0" componentkey="job-card-component-ref-4472661323">
    <div componentkey="job-card-component-ref-4472661323"><p>Creative Content Specialist</p><p>Creative Content Specialist</p><p>City of Lancaster</p><p>Lancaster, PA</p></div></div></div></div></div>
  <div></div>
  <a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4460751737"><p>Vichet Horn</p><p>• 3rd+</p></a>
</div></main></body></html>`;

test("LinkedIn's 2026 cards (no links inside) are read: titles, companies, towns, remote, and no person mistaken for a job", () => {
  const parse = globalThis.LinkedInParse;
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4460751737";
  const found = parse.cards(new JSDOM(REAL, { url }).window.document, url).map(({ job }) => job);
  assert.deepStrictEqual(found.map((job) => job.job_id), ["4466104575", "4460751737", "4472661323"]);
  assert.deepStrictEqual(found.map((job) => job.title), ["Graphic Designer", "Graphic Designer", "Creative Content Specialist"]);
  assert.deepStrictEqual(found.map((job) => job.company), ["GemHarvest Executive Recruiting", "Kidde Global Solutions", "City of Lancaster"]);
  assert.deepStrictEqual(found.map((job) => job.location), ["Baltimore, MD (On-site)", "United States (Remote)", "Lancaster, PA"]);
  assert.deepStrictEqual(found.map((job) => job.work_arrangement), ["On-site", "Remote", ""]);
  assert.strictEqual(found[0].salary, "$90K/yr - $110K/yr");
});

test("on the 2026 layout: Fit tags, 'Remote' first then nearest, unknown last, remote tagged", async () => {
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4460751737";
  const window = new JSDOM(REAL, { url, pretendToBeVisual: true, runScripts: "outside-only" }).window;
  window.browser = { runtime: { sendMessage: async () => ({ places: { "Baltimore, MD (On-site)": { minutes: 45, text: "21 mi · ~45 min" },
      "Lancaster, PA": { minutes: 75, text: "39 mi · ~75 min" } } }) },
    storage: { local: { get: async () => ({ fitProfile: { titles: ["Graphic Designer"], skills: [], work_preferences: [] }, sortByDistance: true }),
      }, onChanged: { addListener() {} } } };
  window.LinkedInParse = globalThis.LinkedInParse;
  window.LinkedInFit = globalThis.LinkedInFit;
  window.eval(require("node:fs").readFileSync(require.resolve("../extension/content/fit-marks.js"), "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 900));
  const slots = Array.from(window.document.querySelectorAll("#column > div")).filter((d) => d.querySelector("[componentkey]"));
  const order = slots.map((slot) => [slot.querySelector("[componentkey]").getAttribute("componentkey").slice(-4), Number(slot.style.order)])
    .sort((a, b) => a[1] - b[1]).map(([id]) => id);
  assert.deepStrictEqual(order, ["1737", "4575", "1323"]); // remote, then 45 min, then 75 min
  const labels = Array.from(window.document.querySelectorAll("wjs-fit-tag[data-distance]"), (tag) => tag.dataset.label).sort();
  assert.deepStrictEqual(labels, ["21 mi · ~45 min", "39 mi · ~75 min", "Remote · no commute"]);
  assert.strictEqual(window.document.querySelectorAll("[data-wjs-fit]").length, 2); // both Graphic Designer cards fit
  window.close();
});

function hidingPage({ hidden = [], blocked = [] } = {}) {
  const url = "https://www.linkedin.com/jobs/search-results/?currentJobId=4460751737";
  const window = new JSDOM(REAL, { url, pretendToBeVisual: true, runScripts: "outside-only" }).window;
  const stored = { hiddenCompanies: hidden, fitProfile: { titles: ["Graphic Designer"], skills: [], work_preferences: [], blocked_companies: blocked }, sortByDistance: true };
  const saves = [], listeners = [];
  window.browser = { runtime: { sendMessage: async () => ({ places: { "Baltimore, MD (On-site)": { minutes: 45, text: "21 mi · ~45 min" } } }) },
    storage: { local: { get: async () => stored, set: async (values) => { saves.push(values); Object.assign(stored, values); } },
      onChanged: { addListener: (fn) => listeners.push(fn) } } };
  window.LinkedInParse = globalThis.LinkedInParse;
  window.LinkedInFit = globalThis.LinkedInFit;
  window.eval(require("node:fs").readFileSync(require.resolve("../extension/content/fit-marks.js"), "utf8"));
  return { window, saves, listeners };
}
const slotOf = (window, id) => window.document.querySelector(`[componentkey='job-card-component-ref-${id}']`).closest("#column > div");

test("every card gets a Fit tag AND a hide button; the Fit tag isn't lost when a distance tag is there", async () => {
  const { window } = hidingPage();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const card = window.document.querySelector("[role='button'][componentkey='job-card-component-ref-4466104575']");
  assert.ok(card.querySelector(":scope > wjs-fit-tag[data-fit]"));
  const bar = card.querySelector(":scope > wjs-fit-tag[data-bar]"); // the green bar is its own overlay, not a style LinkedIn's boxes can cover
  assert.ok(bar);
  assert.match(bar.shadowRoot.innerHTML, /#0b7a55/);
  assert.match(bar.style.cssText, /pointer-events: none/);
  assert.ok(card.querySelector(":scope > wjs-fit-tag[data-distance]"));
  assert.strictEqual(card.querySelector(":scope > wjs-fit-tag[data-hide]").dataset.company, "GemHarvest Executive Recruiting");
  const x = card.querySelector(":scope > wjs-fit-tag[data-hide]").shadowRoot.querySelector("button");
  assert.match(x.style.cssText, /border: 2px solid (?:#dc2626|rgb\(220, 38, 38\))/); // a red circle
  assert.match(x.style.cssText, /border-radius: 50%/);
  window.close();
});

test("the X hides every job from that company, remembers it, and never clicks the card", async () => {
  const { window, saves } = hidingPage();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const card = window.document.querySelector("[role='button'][componentkey='job-card-component-ref-4460751737']");
  let cardClicked = false;
  card.addEventListener("click", () => { cardClicked = true; });
  card.querySelector("wjs-fit-tag[data-hide]").shadowRoot.querySelector("button").click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.deepStrictEqual([...saves.at(-1).hiddenCompanies], ["Kidde Global Solutions"]);
  assert.strictEqual(cardClicked, false);
  assert.strictEqual(slotOf(window, "4460751737").style.getPropertyValue("display"), "none");
  assert.notStrictEqual(slotOf(window, "4466104575").style.getPropertyValue("display"), "none"); // others stay
  window.close();
});

test("companies you hid before, and ones blocked in Job Finder, are hidden on load (spelling and case don't matter)", async () => {
  const { window } = hidingPage({ hidden: ["city of  LANCASTER"], blocked: ["gemharvest executive recruiting"] });
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.strictEqual(slotOf(window, "4472661323").style.getPropertyValue("display"), "none");
  assert.strictEqual(slotOf(window, "4466104575").style.getPropertyValue("display"), "none");
  assert.notStrictEqual(slotOf(window, "4460751737").style.getPropertyValue("display"), "none");
  window.close();
});

test("taking a company out of the hidden list (the panel's Unhide) brings its cards back", async () => {
  const { window, listeners } = hidingPage({ hidden: ["City of Lancaster"] });
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.strictEqual(slotOf(window, "4472661323").style.getPropertyValue("display"), "none");
  for (const listener of listeners) listener({ hiddenCompanies: { newValue: [] } }, "local"); // what Firefox sends the page
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.notStrictEqual(slotOf(window, "4472661323").style.getPropertyValue("display"), "none");
  window.close();
});

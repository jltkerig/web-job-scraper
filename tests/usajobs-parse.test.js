// Reading USAJOBS pages you open. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/usajobs-parse.js");

const parse = globalThis.UsajobsParse;
const SEARCH = "https://www.usajobs.gov/search/results/?k=graphic+design&p=1";

function card(id, title, org, where, dates, pay) {
  return `<div class="page-section"><div><h2><a href="https://www.usajobs.gov/job/${id}" data-document-id="${id}">${title}</a></h2></div>
    <div class="grid"><div><div><strong>${org[0]}</strong> • ${org[1]}</div>
      <div class="flex"><svg><use xlink:href="/img/icons/sprite.svg#location_on"></use></svg>${where}</div>
      <div class="mt-2"><svg><use xlink:href="/img/icons/sprite.svg#schedule"></use></svg> <span>${dates}</span></div></div>
      <div><div><span class="badge badge-secondary">${pay}</span><span class="badge badge-secondary">Permanent</span></div></div></div></div>`;
}

function read(html, url = SEARCH) {
  return parse.fromDom(new JSDOM(html, { url }).window.document, url);
}

test("a search page gives one job per result box", () => {
  const jobs = read(`<main><div id="search-results">
    ${card("880142800", "Graphics Designer", ["Central Intelligence Agency", "Other Agencies"], "Washington, District of Columbia", "Open 09/01/2026 to 01/31/2027", "Starting at $63,940 Per year (GS 8-13)")}
    ${card("882339100", "PUBLICITY ASSISTANT", ["Air Force Special Operations Command", "Department of the Air Force"], "Cannon AFB, New Mexico + 1 location(s)", "Open 09/02/2026 to 10/08/2026", "Starting at $18 Per hour (NF 3)")}
  </div></main>`);
  assert.strictEqual(jobs.length, 2);
  const [first, second] = jobs;
  assert.strictEqual(first.site, "usajobs");
  assert.strictEqual(first.job_id, "880142800");
  assert.strictEqual(first.title, "Graphics Designer");
  assert.strictEqual(first.company, "Central Intelligence Agency");
  assert.strictEqual(first.location, "Washington, DC");
  assert.strictEqual(first.salary, "$63,940/year (GS 8-13)");
  assert.strictEqual(first.posted, "2026-09-01");
  assert.strictEqual(first.closed, false);
  assert.strictEqual(first.closes, "2027-01-31"); // kept, so Job Finder can close it once the date passes
  assert.strictEqual(first.url, "https://www.usajobs.gov/job/880142800");
  assert.strictEqual(first.page_kind, "search");
  assert.strictEqual(second.location, "Cannon AFB, NM");
  assert.strictEqual(second.salary, "$18/hour (NF 3)");
});

test("a job whose closing date has passed is marked closed", () => {
  const [job] = read(`<main>${card("1", "Old Job", ["Agency", "Dept"], "Reno, Nevada", "Open 01/01/2020 to 02/01/2020", "Starting at $1 Per year")}</main>`);
  assert.strictEqual(job.closed, true);
});

test("a page with no results gives no jobs", () => {
  assert.deepStrictEqual(read("<main><h1>Search results</h1><h2>No jobs found</h2></main>"), []);
});

test("a bare job page is read by its number and heading", () => {
  const url = "https://www.usajobs.gov/job/880142800";
  const jobs = read("<main><h1>Graphics Designer</h1><p>Duties of the job.</p></main>", url);
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].job_id, "880142800");
  assert.strictEqual(jobs[0].title, "Graphics Designer");
  assert.strictEqual(parse.detailId(url, jobs), "880142800");
  assert.strictEqual(parse.pageKind(url), "other");
});

test("only search and job pages count as jobs pages", () => {
  assert.strictEqual(parse.onJobsPage(new URL(SEARCH)), true);
  assert.strictEqual(parse.onJobsPage(new URL("https://www.usajobs.gov/job/1")), true);
  assert.strictEqual(parse.onJobsPage(new URL("https://www.usajobs.gov/applicant/profile/")), false);
  assert.strictEqual(parse.expectsJobs(SEARCH), true);
});

test("state names become codes, other places are left alone", () => {
  assert.strictEqual(parse.place("Stuttgart, Germany"), "Stuttgart, Germany");
  assert.strictEqual(parse.place("Adams County, Pennsylvania"), "Adams County, PA");
});

test("a job page is read from its banner, Overview box and sections", () => {
  const url = "https://www.usajobs.gov/job/885547900";
  const [job] = read(`<main><div class="joa-header"><h1 class="usajobs-joa-banner__title">Teacher (Digital Media Communications)</h1>
    <div class="usajobs-joa-banner__dept">Department of Defense</div><div class="usajobs-joa-banner__agency">Department of War Education Activity</div></div>
    <div id="joa-summary"><h2>Summary</h2><p>About the Position: a ${"long summary ".repeat(15)}</p></div>
    <div id="joa-duties"><h2>Duties</h2><p>Develop and deliver a curriculum.</p></div>
    <div id="joa-requirements"><h2>Requirements</h2><p>Must hold a license.</p></div>
    <div><h2>Overview</h2><span>Accepting applications</span><span>Open 09/24/2026 to 10/06/2099</span>
      <span>Location</span><span>1 vacancy in the following location:</span><span>Stuttgart, Germany</span>
      <span>Telework eligible</span><span>No</span><span>Remote job</span><span>Yes</span>
      <span>Salary</span><span>$57,675 - $114,825 per year</span></div></main>`, url);
  assert.strictEqual(job.title, "Teacher (Digital Media Communications)");
  assert.strictEqual(job.company, "Department of War Education Activity");
  assert.strictEqual(job.location, "Stuttgart, Germany");
  assert.strictEqual(job.salary, "$57,675 - $114,825/year");
  assert.strictEqual(job.posted, "2026-09-24");
  assert.strictEqual(job.closes, "2099-10-06");
  assert.strictEqual(job.work_arrangement, "Remote");
  assert.strictEqual(job.closed, false);
  assert.strictEqual(job.level, "opened");
  assert.match(job.description, /Develop and deliver a curriculum/);
});

test("a page saved for fixing has no scripts and nothing typed into a field", () => {
  const { JSDOM: Dom } = require("jsdom");
  const dom = new Dom(`<html><body><main><h1>Jobs</h1><input name="q" value="my secret search"><textarea>private note</textarea>
    <script>window.me = "Jamie"</script></main></body></html>`, { url: SEARCH, runScripts: "outside-only" });
  dom.window.browser = { runtime: { onMessage: { addListener: (fn) => { dom.window.listener = fn; } }, sendMessage: async () => {} } };
  dom.window.UsajobsParse = parse;
  dom.window.CaptureParse = parse;
  dom.window.eval(require("fs").readFileSync(require.resolve("../extension/content/capture.js"), "utf8"));
  return dom.window.listener({ type: "get-page-html" }).then(({ html }) => {
    assert.doesNotMatch(html, /my secret search|private note|window\.me/);
    assert.match(html, /<h1>Jobs<\/h1>/);
    dom.window.close();
  });
});

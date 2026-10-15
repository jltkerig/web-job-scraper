// Reading Indeed's hidden web data (script variables) and, as a fallback, its visible cards.
// Run with: npm install, then npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/indeed-parse.js");

const parse = globalThis.IndeedParse;
const URL_SEARCH = "https://www.indeed.com/jobs?q=graphic+designer&l=Abingdon%2C+MD&vjk=2a84c7c5ca3dd1a0";

const CARDS = {
  metaData: { mosaicProviderJobCardsModel: { results: [
    { jobkey: "2a84c7c5ca3dd1a0", displayTitle: "Graphics Specialist", company: "Systems Products and Solutions, Inc",
      formattedLocation: "Aberdeen Proving Ground, MD 21005", salarySnippet: { currency: "", salaryTextFormatted: false },
      pubDate: 1771480800000, remoteLocation: false, snippet: "a string with a brace } and a quote \" and ;}; inside" },
    { jobkey: "b1", displayTitle: "Graphic Production Designer", company: "FASTSIGNS", formattedLocation: "Joppa, MD 21085",
      salarySnippet: { text: "$35,000 - $45,000 a year" }, extractedSalary: { min: 35000, max: 45000, type: "YEARLY" } },
    { jobkey: "c2", displayTitle: "CDL-A Truck Driver", company: "C.R. England", formattedLocation: "Parkville, MD 21234",
      salarySnippet: { text: "$0.57 per mile" }, extractedSalary: { min: 79560, max: 108732, type: "YEARLY" } },
    { jobkey: "d3", displayTitle: "Web Designer", company: "Acme", formattedLocation: "Remote", remoteLocation: true, expired: true },
    { jobkey: "e4", displayTitle: "Unpaid card", company: "Beta", formattedLocation: "Bel Air, MD",
      extractedSalary: { min: 50000, max: 60000, type: "YEARLY" } },
  ] } },
};
const INITIAL = {
  autoOpenTwoPaneJobKey: "2a84c7c5ca3dd1a0",
  autoOpenTwoPaneViewjobResponse: { status: 200, body: { jobInfoWrapperModel: { jobInfoModel: {
    jobInfoHeaderModel: { jobTitle: "Graphics Specialist - Intermediate", companyName: "Systems Products and Solutions, Inc",
      formattedLocation: "Aberdeen Proving Ground, MD 21005" },
    sanitizedJobDescription: "<div><p><b>Title: Graphics Specialist</b></p><p>" + "Create graphics for training material. ".repeat(8) + "</p></div>",
  } } } },
};

function page(scripts, body = "") {
  return `<!doctype html><html><head><title>Jobs | Indeed</title></head><body>${body}${scripts.map((s) => `<script>${s}</script>`).join("")}</body></html>`;
}
function read(html, url = URL_SEARCH, done) {
  const dom = new JSDOM(html, { url });
  return { jobs: parse.fromEmbedded(dom.window.document, url, done), dom };
}

test("the job cards are cut out of the script variable, even with braces and quotes inside a string", () => {
  const html = page([`window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(CARDS)};window.other=1;`]);
  const { jobs } = read(html);
  assert.deepStrictEqual(jobs.map((job) => job.job_id), ["2a84c7c5ca3dd1a0", "b1", "c2", "d3", "e4"]);
  assert.strictEqual(jobs[0].title, "Graphics Specialist");
  assert.strictEqual(jobs[0].company, "Systems Products and Solutions, Inc");
  assert.strictEqual(jobs[0].location, "Aberdeen Proving Ground, MD 21005");
  assert.strictEqual(jobs[0].url, "https://www.indeed.com/viewjob?jk=2a84c7c5ca3dd1a0");
  assert.strictEqual(jobs[0].posted, "2026-02-19");
  assert.strictEqual(jobs[0].site, "indeed");
});

test("pay is the card's own text; an estimate is never shown when there is no pay text", () => {
  const { jobs } = read(page([`window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(CARDS)};`]));
  const pay = Object.fromEntries(jobs.map((job) => [job.job_id, job.salary]));
  assert.strictEqual(pay.b1, "$35,000 - $45,000 a year");
  assert.strictEqual(pay.c2, "$0.57 per mile");  // not the yearly estimate
  assert.strictEqual(pay.e4, "");                // an estimate alone is not pay
  assert.strictEqual(pay["2a84c7c5ca3dd1a0"], "");
});

test("remote and closed are read from the card", () => {
  const { jobs } = read(page([`window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(CARDS)};`]));
  const byId = Object.fromEntries(jobs.map((job) => [job.job_id, job]));
  assert.strictEqual(byId.d3.work_arrangement, "Remote");
  assert.strictEqual(byId.d3.closed, true);
  assert.strictEqual(byId.b1.work_arrangement, "");
  assert.strictEqual(byId.b1.closed, false);
});

test("the open job's description comes from _initialData and makes it an opened job", () => {
  const { jobs } = read(page([`window._initialData=${JSON.stringify(INITIAL)};`]));
  assert.strictEqual(jobs.length, 1);
  assert.strictEqual(jobs[0].job_id, "2a84c7c5ca3dd1a0");
  assert.strictEqual(jobs[0].title, "Graphics Specialist - Intermediate");
  assert.ok(jobs[0].description.includes("Create graphics for training material."));
  assert.strictEqual(jobs[0].level, "opened");
});

test("a script already read is not read again, and one that does not parse is left to try later", () => {
  const html = page([`window.mosaic.providerData["mosaic-provider-jobcards"]=${JSON.stringify(CARDS)};`, `window._initialData={"broken": `]);
  const done = new WeakSet();
  const dom = new JSDOM(html, { url: URL_SEARCH });
  assert.strictEqual(parse.fromEmbedded(dom.window.document, URL_SEARCH, done).length, 5);
  assert.strictEqual(parse.fromEmbedded(dom.window.document, URL_SEARCH, done).length, 0);
  assert.strictEqual(parse.balanced('{"a": "}", "b": [1, {"c": "\\"}"}]} tail', 0), '{"a": "}", "b": [1, {"c": "\\"}"}]}');
  assert.strictEqual(parse.balanced("{never closed", 0), "");
});

test("the visible cards are the fallback when the script variables are missing", () => {
  const body = `<div data-testid="slider_item"><h3 class="jobTitle"><a data-jk="592c2722db95d968" aria-label="full details of Developer - AI Trainer" class="jcs-JobTitle"><span>Developer - AI Trainer</span></a></h3>
    <span data-testid="company-name">DataAnnotation</span><div data-testid="text-location">Baltimore, MD</div>
    <ul><li class="salary-snippet-container" data-testid="attribute_snippet_testid salary-snippet-container"><span>$75 - $150 an hour</span></li></ul></div>
    <div data-testid="slider_item"><h3 class="jobTitle"><a data-jk="aa11" class="jcs-JobTitle"><span>Web Developer</span></a></h3><span data-testid="company-name">Hybrid Co</span><div data-testid="text-location">Hybrid work in Bel Air, MD</div></div>`;
  const dom = new JSDOM(page([], body), { url: URL_SEARCH });
  const jobs = parse.fromDom(dom.window.document, URL_SEARCH);
  assert.strictEqual(jobs.length, 2);
  assert.deepStrictEqual([jobs[0].job_id, jobs[0].title, jobs[0].company, jobs[0].location, jobs[0].salary],
    ["592c2722db95d968", "Developer - AI Trainer", "DataAnnotation", "Baltimore, MD", "$75 - $150 an hour"]);
  assert.strictEqual(jobs[1].title, "Web Developer");
  assert.strictEqual(jobs[1].work_arrangement, "Hybrid");
});

test("a title link with no employer next to it (a header or ad slot) is not saved as a job", () => {
  const body = '<h3 class="jobTitle"><a data-jk="zz99" aria-label="full details of Solutions Architect"><span>Solutions Architect</span></a></h3>';
  const dom = new JSDOM(page([], body), { url: URL_SEARCH });
  assert.strictEqual(parse.fromDom(dom.window.document, URL_SEARCH).length, 0);
});

test("which pages count, and which job is open", () => {
  assert.ok(parse.onJobsPage({ pathname: "/jobs" }));
  assert.ok(parse.onJobsPage({ pathname: "/viewjob" }));
  assert.ok(!parse.onJobsPage({ pathname: "/account/view" }));
  assert.ok(parse.expectsJobs(URL_SEARCH));
  assert.ok(!parse.expectsJobs("https://www.indeed.com/"));
  assert.strictEqual(parse.pageKind("https://www.indeed.com/viewjob?jk=abc"), "other");
  assert.strictEqual(parse.pageKind(URL_SEARCH), "search");
  assert.strictEqual(parse.detailId(URL_SEARCH, [{ job_id: "2a84c7c5ca3dd1a0" }]), "2a84c7c5ca3dd1a0");
  assert.strictEqual(parse.detailId(URL_SEARCH, [{ job_id: "zzz" }]), null);
});

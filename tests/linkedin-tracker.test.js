// LinkedIn's job tracker (Saved jobs): the cards of the ticked stage are your own jobs. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/linkedin-parse.js");

const parse = globalThis.LinkedInParse;
const URL_TRACKER = "https://www.linkedin.com/jobs-tracker/";

function card(id, title, company, where, posted, button = "Apply") {
  return `<div><div><a href="https://www.linkedin.com/jobs/view/${id}/">${title}</a></div>
    <div><span>${company} · ${where}</span></div><div><span>${posted}</span></div>
    <div><span>Notes</span><button>Add note</button><a href="https://www.linkedin.com/jobs/view/${id}/apply">${button}</a></div></div>`;
}

// The stage filters are check boxes; the ticked one says what the page lists.
function page(ticked, cards) {
  const stages = ["Saved · 7", "In Progress · 7", "Applied · 51", "Interview · 0", "Archived"];
  const boxes = stages.map((label, n) =>
    `<div><input type="checkbox" id="stage-${n}"${label.toLowerCase().startsWith(ticked) ? " checked" : ""}><label for="stage-${n}">${label}</label></div>`);
  return `<html><head><title>Job tracker | LinkedIn</title></head><body><main><h1>Job tracker</h1>${boxes.join("")}
    <div>${cards.join("")}</div></main></body></html>`;
}

function read(html, url = URL_TRACKER) {
  return parse.fromDom(new JSDOM(html, { url }).window.document, url);
}

const TWO = [
  card("4469068292", "Webinar &amp; Email Marketing Associate", "Ciena", "Baltimore, MD", "Reposted 31m ago"),
  card("4478482363", "Manager, Website &amp; Search", "Food Bank For New York City", "Bronx, NY (Remote)", "Posted 2h ago", "Easy Apply"),
];

test("with only Saved ticked, every job on the tracker is a saved job", () => {
  const jobs = read(page("saved", TWO));
  assert.strictEqual(jobs.length, 2);
  const [first, second] = jobs;
  assert.strictEqual(first.job_id, "4469068292");
  assert.strictEqual(first.title, "Webinar & Email Marketing Associate");
  assert.strictEqual(first.company, "Ciena");
  assert.strictEqual(first.location, "Baltimore, MD");
  assert.strictEqual(first.saved, true);
  assert.strictEqual(first.applied, false);
  assert.strictEqual(first.page_kind, "tracker");
  assert.strictEqual(second.location, "Bronx, NY");
  assert.strictEqual(second.work_arrangement, "Remote");
  assert.strictEqual(second.posted, "Posted 2h ago");
  // LinkedIn's Easy Apply button is on the second card only; the first one's button just says Apply.
  assert.strictEqual(second.easy_apply, true);
  assert.strictEqual(first.easy_apply, undefined);
});

test("Easy Apply is read from a search card's footer and from a job's own header", () => {
  const search = "https://www.linkedin.com/jobs/search/?keywords=designer";
  const cardHtml = `<main><ul><li><a href="https://www.linkedin.com/jobs/view/4400000061/"><p>Web Designer</p><p>Acme Health</p>
    <p>Baltimore, MD</p><p>Easy Apply</p></a></li>
    <li><a href="https://www.linkedin.com/jobs/view/4400000062/"><p>Front End Developer</p><p>Beta Co</p><p>Bel Air, MD</p></a></li></ul></main>`;
  const jobs = parse.fromDom(new JSDOM(cardHtml, { url: search }).window.document, search);
  const byId = Object.fromEntries(jobs.map((job) => [job.job_id, job]));
  assert.strictEqual(byId["4400000061"].easy_apply, true);
  assert.strictEqual(byId["4400000062"].easy_apply, undefined);
  // the data LinkedIn sends: an on-site apply method
  const voyager = { included: [{ entityUrn: "urn:li:fsd_jobPosting:4400000063", title: "Designer", jobState: "LISTED",
    applyMethod: { $type: "com.linkedin.voyager.dash.jobs.ComplexOnsiteApply", easyApply: true } },
    { entityUrn: "urn:li:fsd_jobPosting:4400000064", title: "Developer", applyMethod: { $type: "com.linkedin.voyager.jobs.OffsiteApply" } }] };
  const fromData = Object.fromEntries(parse.fromVoyager(voyager, search).map((job) => [job.job_id, job]));
  assert.strictEqual(fromData["4400000063"].easy_apply, true);
  assert.strictEqual(fromData["4400000064"].easy_apply, undefined);
});

test("with only Applied ticked, the jobs are applied jobs and not saved ones", () => {
  const jobs = read(page("applied", TWO));
  assert.strictEqual(jobs.length, 2);
  assert.ok(jobs.every((job) => job.applied === true && !job.saved));
});

test("with several stages ticked a card says nothing about its stage", () => {
  const html = page("saved", TWO).replace('id="stage-1"', 'id="stage-1" checked');
  const jobs = read(html);
  assert.strictEqual(jobs.length, 2);
  assert.ok(jobs.every((job) => !job.saved && !job.applied));
});

test("the saved-jobs address is read the same way", () => {
  const url = "https://www.linkedin.com/my-items/saved-jobs/";
  const jobs = read(page("saved", TWO), url);
  assert.strictEqual(jobs.length, 2);
  assert.ok(jobs.every((job) => job.saved === true));
});

test("the tracker is not a Jobs page: no page marks, fox strip or reordering there", () => {
  assert.strictEqual(parse.onJobsPage({ pathname: "/jobs-tracker/" }), false);
  assert.strictEqual(parse.onJobsPage({ pathname: "/jobs-tracker" }), false);
  assert.strictEqual(parse.onJobsPage({ pathname: "/jobs/" }), true);
  assert.strictEqual(parse.onJobsPage({ pathname: "/jobs" }), true);
  assert.strictEqual(parse.onJobsPage({ pathname: "/jobs/search/" }), true);
  assert.strictEqual(parse.onJobsPage({ pathname: "/jobs/view/4469068292/" }), true);
  assert.strictEqual(parse.readsPage({ hostname: "www.linkedin.com", pathname: "/jobs-tracker/" }), true); // still read
});

test("a job page is never marked saved", () => {
  const url = "https://www.linkedin.com/jobs/view/4469068292/";
  const jobs = read(page("saved", TWO), url);
  assert.ok(jobs.every((job) => !job.saved));
});

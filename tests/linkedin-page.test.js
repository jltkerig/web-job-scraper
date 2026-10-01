// Reading LinkedIn's 2026 page layout (scrambled class names, text in its own elements).
// Run with: npm install, then npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/linkedin-parse.js");

const parse = globalThis.LinkedInParse;

// Shaped like a saved job page: header lines, an "About the job" section, a contact box and "More jobs" cards.
const JOB_PAGE = `<!doctype html><html><head><title>Web Specialist | Acme Health | LinkedIn</title></head><body>
<nav><a href="/feed/">Home</a><a href="/jobs/">Jobs</a></nav>
<main><div class="x1"><div class="x2">
  <div class="x3"><a href="/company/acme/"><p>Acme Health</p></a></div>
  <div class="x4"><p>Web Specialist</p></div>
  <div class="x5"><span>Baltimore, MD</span><span>·</span><span>Reposted 2 weeks ago</span><span>·</span>
    <span>Over 100 people clicked apply</span></div>
  <a href="https://www.linkedin.com/jobs/view/4455363386/"><span>On-site</span></a>
  <div class="x6"><span>• $10,000 Sign-On Bonus for eligible opportunities</span></div>
  <h2>Application status</h2><p>Applied on company site</p><p>1 month ago</p>
  <h2>People you can reach out to</h2>
  <a href="https://www.linkedin.com/messaging/compose/?currentJobId=4455363386"><p>Pat Example, MS</p><p>• 2nd</p>
    <p>Baltimore, MD</p></a>
  <div class="x7"><div class="x8"><h2>About the job</h2></div>
    <div class="x9"><p>Summary:</p><p>${"The Web Specialist keeps the website current and accessible. ".repeat(6)}</p></div></div>
</div></div>
<section><h2>More jobs</h2>
  <a href="https://www.linkedin.com/jobs/search-results/?keywords=Web&amp;currentJobId=4453736853">
    <p>Web Content Manager (Verified job)</p><p>Arrivia</p><p>Scottsdale, AZ (Hybrid)</p><p>$70K/yr - $90K/yr</p><p>Promoted</p></a>
  <a href="https://www.linkedin.com/jobs/search-results/?keywords=Web&amp;currentJobId=4466111503">
    <p>Web Manager</p><p>Rockford Audio</p><p>Tempe, AZ (On-site)</p><p>Applied</p></a>
  <a href="https://www.linkedin.com/jobs/search-results/?keywords=Web&amp;currentJobId=4400000001">
    <p>Perplexity</p><p>201-500 employees · Software Development</p></a>
</section></main></body></html>`;

function read(html, url) {
  const dom = new JSDOM(html, { url });
  return Object.fromEntries(parse.fromDom(dom.window.document, url).map((job) => [job.job_id, job]));
}

test("reads the open job's header and description", () => {
  const jobs = read(JOB_PAGE, "https://www.linkedin.com/jobs/view/4455363386/");
  const job = jobs["4455363386"];
  assert.strictEqual(job.title, "Web Specialist");
  assert.strictEqual(job.company, "Acme Health");
  assert.strictEqual(job.location, "Baltimore, MD");
  assert.strictEqual(job.work_arrangement, "On-site");
  assert.strictEqual(job.posted, "Reposted 2 weeks ago");
  assert.strictEqual(job.salary, ""); // a sign-on bonus is not pay
  assert.strictEqual(job.applied, true); // "Applied on company site"
  assert.strictEqual(job.level, "opened");
  assert.match(job.description, /^Summary:\nThe Web Specialist keeps/);
});

test("reads the job cards and ignores links that only mention a job", () => {
  const jobs = read(JOB_PAGE, "https://www.linkedin.com/jobs/view/4455363386/");
  assert.deepStrictEqual(Object.keys(jobs).sort(), ["4453736853", "4455363386", "4466111503"]);
  const card = jobs["4453736853"];
  assert.strictEqual(card.title, "Web Content Manager");
  assert.strictEqual(card.company, "Arrivia");
  assert.strictEqual(card.location, "Scottsdale, AZ (Hybrid)");
  assert.strictEqual(card.work_arrangement, "Hybrid");
  assert.strictEqual(card.salary, "$70K/yr - $90K/yr");
  assert.strictEqual(card.level, "seen");
  assert.strictEqual(jobs["4466111503"].applied, true);
});

test("on a search page the open job comes from the details pane", () => {
  const jobs = read(JOB_PAGE.replace("<title>Web Specialist | Acme Health | LinkedIn</title>", "<title>Search | LinkedIn</title>"),
    "https://www.linkedin.com/jobs/search-results/?keywords=Web&currentJobId=4455363386");
  assert.strictEqual(jobs["4455363386"].title, "Web Specialist");
  assert.strictEqual(jobs["4455363386"].company, "Acme Health");
  assert.strictEqual(jobs["4455363386"].page_kind, "search");
});

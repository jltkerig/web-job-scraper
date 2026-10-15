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

test("LinkedIn's own notice among the header lines is not saved as the title or company", () => {
  const url = "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4477824442";
  const html = `<!doctype html><html><head><title>Jobs | LinkedIn</title></head><body><main><div class="a"><div class="b">
    <div><a href="/company/pgs/"><p>Park Group Solutions</p></a></div>
    <div><p>Web Developer / Production Specialist (Automotive)</p></div>
    <div><p>resume was downloaded</p><p>Your</p></div>
    <div><span>United States (Remote)</span><span>·</span><span>3 days ago</span></div>
    <div class="c"><h2>About the job</h2><p>${"Park Group Solutions is a full-service advertising agency. ".repeat(6)}</p></div>
  </div></div></main></body></html>`;
  const jobs = read(html, url);
  const job = jobs["4477824442"];
  assert.strictEqual(job.title, "Web Developer / Production Specialist (Automotive)");
  assert.strictEqual(job.company, "Park Group Solutions");
  assert.strictEqual(job.location, "United States (Remote)");
});

test("a closed job's own page is read as closed even without the usual header", () => {
  const url = "https://www.linkedin.com/jobs/view/4475979428/";
  const html = `<!doctype html><html><head><title>Front End Web Applications Developer (Mid-Level) (5664) | RemoteHunter | LinkedIn</title></head>
    <body><main><div><p>RemoteHunter</p><p>Front End Web Applications Developer (Mid-Level) (5664)</p>
    <p class="notice">No longer accepting applications</p></div>
    <section><h2>More jobs</h2><a href="https://www.linkedin.com/jobs/view/4400000009/"><p>Web Designer</p><p>Acme</p></a></section></main></body></html>`;
  const job = read(html, url)["4475979428"];
  assert.strictEqual(job.closed, true);
  assert.strictEqual(job.title, "Front End Web Applications Developer (Mid-Level) (5664)");
  assert.strictEqual(job.company, "RemoteHunter");
});

test("an open job's own page is not read as closed because of its list", () => {
  const url = "https://www.linkedin.com/jobs/view/4455363386/";
  assert.strictEqual(read(JOB_PAGE, url)["4455363386"].closed, false);
});

test("jobs are read on any LinkedIn page, and a message that mentions a job is not a job", () => {
  assert.strictEqual(parse.readsPage({ hostname: "www.linkedin.com", pathname: "/feed/" }), true);
  assert.strictEqual(parse.readsPage({ hostname: "www.linkedin.com", pathname: "/my-items/saved-jobs/" }), true);
  assert.strictEqual(parse.readsPage({ hostname: "www.indeed.com", pathname: "/jobs" }), false);
  assert.strictEqual(parse.onJobsPage({ pathname: "/feed/" }), false); // the page marks stay on the Jobs pages
  const url = "https://www.linkedin.com/my-items/saved-jobs/";
  const html = `<main><ul>
    <li><a href="https://www.linkedin.com/jobs/view/4400000051/"><p>Web Designer</p><p>Acme Health</p><p>Baltimore, MD</p><p>No longer accepting applications</p></a></li>
    <li><a href="https://www.linkedin.com/jobs/view/4400000052/"><p>Front End Developer</p><p>Beta Co</p><p>Bel Air, MD (Hybrid)</p></a></li>
    <li class="message"><p>Pat Example</p><p>Thought of you: <a href="https://www.linkedin.com/jobs/view/4400000053/">this job</a></p></li>
  </ul></main>`;
  const jobs = read(html, url);
  assert.deepStrictEqual(Object.keys(jobs).sort(), ["4400000051", "4400000052"]);
  assert.strictEqual(jobs["4400000051"].closed, true);
  assert.strictEqual(jobs["4400000051"].company, "Acme Health");
  assert.strictEqual(jobs["4400000052"].closed, false);
});

test("a card's LinkedIn notice between the title and the company is not saved as the company", () => {
  const html = `<!doctype html><html><body><main><section><h2>Jobs</h2>
    <div componentkey="job-card-component-ref-4471738749"><p>Web Developer (CMS) (Verified job)</p><p>Web Developer (CMS)</p>
      <p>Your application was viewed</p><p>Acme Health</p><p>Hunt Valley, MD (Hybrid)</p><p>Applied</p></div>
    <a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4455555555"><p>Web Designer</p><p>application was viewed</p><p>Beta Studio</p><p>Baltimore, MD</p></a>
  </section></main></body></html>`;
  const dom = new JSDOM(html, { url: "https://www.linkedin.com/jobs/search-results/?keywords=web" });
  const jobs = Object.fromEntries(parse.cards(dom.window.document, dom.window.location.href).map(({ job }) => [job.job_id, job]));
  assert.strictEqual(jobs["4471738749"].company, "Acme Health");
  assert.strictEqual(jobs["4455555555"].company, "Beta Studio");
});

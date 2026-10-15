// Reading Maryland Workforce Exchange pages you open. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/mwe-parse.js");

const parse = globalThis.MweParse;
const DETAIL = "https://mwejobs.maryland.gov/vosnet/jobbanks/jobdetails.aspx?enc=9B8abc";
const LIST = "https://mwejobs.maryland.gov/vosnet/jobbanks/joblist.aspx?q=web";

function read(html, url) {
  const dom = new JSDOM(html, { url });
  return parse.fromDom(dom.window.document, url);
}

test("a job page with search-engine job data is read from it", () => {
  const data = {
    "@context": "https://schema.org", "@type": "JobPosting", title: "Web and Digital Interface Designer, Advanced",
    hiringOrganization: { "@type": "Organization", name: "PSI Pax Inc" },
    jobLocation: { "@type": "Place", address: { addressLocality: "Aberdeen Proving Ground", addressRegion: "MD" } },
    datePosted: "2026-09-25T00:00:00", description: `<p>${"Designs and develops digital user interfaces. ".repeat(5)}</p>`,
    baseSalary: { value: { minValue: 90000, maxValue: 120000, unitText: "YEAR" } },
  };
  const [job] = read(`<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body></body></html>`, DETAIL);
  assert.strictEqual(job.site, "mwe");
  assert.strictEqual(job.title, "Web and Digital Interface Designer, Advanced");
  assert.strictEqual(job.company, "PSI Pax Inc");
  assert.strictEqual(job.location, "Aberdeen Proving Ground, MD");
  assert.strictEqual(job.posted, "2026-09-25");
  assert.strictEqual(job.salary, "$90000 - $120000/year");
  assert.strictEqual(job.level, "opened");
  assert.match(job.description, /^Designs and develops/);
  assert.strictEqual(job.url, DETAIL);
  assert.match(job.job_id, /^[0-9a-f]{8}$/);
});

test("without job data, a job page is read from its labels", () => {
  const html = `<html><body><form><h1>Job Details</h1><h2>Graphic Designer</h2>
    <div><span>Employer:</span> <span>Three Saints Bay</span></div>
    <div><span>Location:</span> <span>Aberdeen, MD</span></div>
    <div>Date Posted: 09/28/2026</div>
    <h3>Job Description</h3><p>${"Create graphics and layouts for print and web. ".repeat(5)}</p></form></body></html>`;
  const [job] = read(html, DETAIL);
  assert.strictEqual(job.title, "Graphic Designer");
  assert.strictEqual(job.company, "Three Saints Bay");
  assert.strictEqual(job.location, "Aberdeen, MD");
  assert.strictEqual(job.posted, "09/28/2026");
  assert.strictEqual(job.level, "opened");
});

test("search results become cards, and a card and its job page share an id", () => {
  const html = `<html><body><table>
    <tr><td><a href="jobdetails.aspx?enc=AAA">Graphic Designer</a></td><td>Three Saints Bay</td><td>Aberdeen, MD</td><td>Posted 2 days ago</td></tr>
    <tr><td><a href="jobdetails.aspx?enc=BBB">Forklift Operator</a></td><td>Acme</td><td>Belcamp, MD</td></tr>
  </table></body></html>`;
  const cards = read(html, LIST);
  assert.deepStrictEqual(cards.map((card) => [card.title, card.company, card.location]),
    [["Graphic Designer", "Three Saints Bay", "Aberdeen, MD"], ["Forklift Operator", "Acme", "Belcamp, MD"]]);
  assert.strictEqual(cards[0].url, "https://mwejobs.maryland.gov/vosnet/jobbanks/jobdetails.aspx?enc=AAA");
  assert.strictEqual(cards[0].level, "seen");
  assert.strictEqual(cards[0].page_kind, "search");
  assert.strictEqual(cards[0].job_id, parse.jobKey("Graphic Designer", "Three Saints Bay", "Aberdeen, MD"));
});

test("which pages are job pages", () => {
  assert.strictEqual(parse.expectsJobs(DETAIL), true);
  assert.strictEqual(parse.expectsJobs("https://mwejobs.maryland.gov/vosnet/default.aspx"), false);
  assert.strictEqual(parse.onJobsPage(new URL(LIST)), true);
  assert.strictEqual(parse.detailId(DETAIL, [{ job_id: "abc" }]), "abc");
  assert.strictEqual(parse.detailId(LIST, [{ job_id: "abc" }]), null);
});

test("a title with a highlighted search word is read whole, and dates and buttons are not jobs", () => {
  const html = `<html><body><table>
    <tr><td><a href="jobdetails.aspx?enc=a1"><b>Graphic</b> Designer</a></td><td>Acme Studio</td><td>Bethesda, MD</td>
      <td><a href="jobdetails.aspx?enc=a1">11/07/2024</a></td><td><a href="jobdetails.aspx?enc=a1">Apply</a></td></tr>
    <tr><td><a href="jobdetails.aspx?enc=b2">Web Developer</a></td>
      <td>This chart is used to compare your background against this job to help to determine if you would be a good fit</td>
      <td>Laurel, MD</td></tr></table></body></html>`;
  const jobs = read(html, LIST);
  assert.deepStrictEqual(jobs.map((job) => job.title), ["Graphic Designer", "Web Developer"]);
  assert.strictEqual(jobs[0].company, "Acme Studio");
  assert.strictEqual(jobs[1].company, "");
});

test("a page whose only heading is a section name gives no job rather than a wrong one", () => {
  const html = `<html><body><form><h2>Job Summary</h2><div>Some text</div></form></body></html>`;
  assert.deepStrictEqual(read(html, DETAIL), []);
});

test("the site's own result cards give title, employer, town and pay", () => {
  const card = (id, title, employer, town, pay) => `<div class="JCardEmployerArea"><h2 class="JCardHeader2">
    <a id="lnkJobOrderTitle_${id}" href="https://mwejobs.maryland.gov/vosnet/jobbanks/jobdetails.aspx?enc=AB/${id}+x==" class="JCardTitle" title="Job Title">
    Experiential <span class="highlight_keyword">Graphic</span> Designer: </a></h2>
    <div class="JCardEmployer "> ${employer} <div class="JCardEmployerLocation"> ${town}&nbsp;&nbsp; </div></div>
    <div class="JCardTypePay"> Regular | ${pay} </div><div class="JCardDateCity">&nbsp;6 days ago</div></div>
    <div class="JCardDescription">This chart is used to compare your background against this job</div>`;
  const jobs = read(`<html><body>${card(1, "", "Ayers Saint Gross", "Baltimore, MD", "$65,000.00 Year")}${card(2, "", "Acme Inc", "Laurel, MD", "$20.00 Hour")}</body></html>`, LIST);
  assert.strictEqual(jobs.length, 2);
  assert.strictEqual(jobs[0].title, "Experiential Graphic Designer");
  assert.strictEqual(jobs[0].company, "Ayers Saint Gross");
  assert.strictEqual(jobs[0].location, "Baltimore, MD");
  assert.strictEqual(jobs[0].salary, "$65,000.00 Year");
  assert.strictEqual(jobs[1].salary, "$20.00 Hour");
  assert.notStrictEqual(jobs[0].job_id, jobs[1].job_id);
});

test("the search form page is not a jobs page, the results page is", () => {
  assert.strictEqual(parse.expectsJobs("https://mwejobs.maryland.gov/vosnet/JobBanks/JobSearchCriteriaQuick.aspx?nf=1&"), false);
  assert.strictEqual(parse.expectsJobs("https://mwejobs.maryland.gov/vosnet/jobbanks/joblist.aspx?enc=91Ai"), true);
});

test("the fit chart's sentence is recognised as a bad employer, a real name is not", () => {
  const parse = globalThis.MweParse;
  assert.ok(parse.badCompany("This chart is used to compare your background against this job to help to determine if you would be a good fit."));
  assert.ok(parse.badCompany("You match null% of the General Job Requirements."));
  assert.ok(!parse.badCompany("Maryland Institute College of Art"));
  assert.ok(!parse.badCompany(""));
});

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

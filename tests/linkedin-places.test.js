// Job cards whose place is outside the U.S. ("Istanbul, Türkiye") get that place as their location, so the job is
// dropped as outside the U.S. instead of waiting in "Needs a look" with no location. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/location-filter.js");
require("../extension/sites/linkedin-parse.js");

const parse = globalThis.LinkedInParse;
const { outsideUS } = globalThis.LocationFilter;

const PAGE = `<!doctype html><html><body><main>
<a href="https://www.linkedin.com/jobs/search-results/?keywords=design&amp;currentJobId=4400000011">
  <p>Grafik Tasarımcısı</p><p>Example Reklam</p><p>İstanbul, İstanbul, Türkiye</p><p>Promoted</p></a>
<a href="https://www.linkedin.com/jobs/search-results/?keywords=design&amp;currentJobId=4400000012">
  <p>Art Director</p><p>Example Studio</p><p>Türkiye</p></a>
<a href="https://www.linkedin.com/jobs/search-results/?keywords=design&amp;currentJobId=4400000013">
  <p>Graphic Designer</p><p>Example Print</p><p>London, England, United Kingdom</p><p>$50K/yr - $60K/yr</p></a>
<a href="https://www.linkedin.com/jobs/search-results/?keywords=design&amp;currentJobId=4400000014">
  <p>Web Designer</p><p>Example Health</p><p>Baltimore, MD (Hybrid)</p></a>
</main></body></html>`;

function read() {
  const url = "https://www.linkedin.com/jobs/search-results/?keywords=design";
  const dom = new JSDOM(PAGE, { url });
  return Object.fromEntries(parse.fromDom(dom.window.document, url).map((job) => [job.job_id, job]));
}

test("a place outside the U.S. is read as the card's location", () => {
  const jobs = read();
  assert.strictEqual(jobs["4400000011"].location, "İstanbul, İstanbul, Türkiye");
  assert.strictEqual(jobs["4400000012"].location, "Türkiye");
  assert.strictEqual(jobs["4400000013"].location, "London, England, United Kingdom");
  assert.strictEqual(jobs["4400000013"].salary, "$50K/yr - $60K/yr");
  for (const id of ["4400000011", "4400000012", "4400000013"]) assert.strictEqual(outsideUS(jobs[id].location), true, id);
});

test("U.S. cards read as before", () => {
  const job = read()["4400000014"];
  assert.strictEqual(job.location, "Baltimore, MD (Hybrid)");
  assert.strictEqual(outsideUS(job.location), false);
});

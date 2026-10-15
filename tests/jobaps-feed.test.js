// Reading the State of Maryland's job feed (RSS). Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
require("../extension/sites/jobaps-feed.js");

const { parse } = globalThis.JobapsFeed;
const Parser = new JSDOM("").window.DOMParser;

function item(title, ids, description) {
  const link = `https://www.jobapscloud.com/MD/sup/BulPreview.asp?R1=${ids[0]}&amp;R2=${ids[1]}&amp;R3=${ids[2]}`;
  return `<item><title>${title}\n</title><link>${link}</link><pubDate>Wed, 14 Oct 2026 16:00:00 EST</pubDate>
    <description>${description.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</description></item>`;
}
const BODY = "<p><strong>Department:</strong> LABOR - Family and Medical Leave Insurance</p>"
  + "<p><strong>Date Opened:</strong> 10/14/2026 4:00:00 PM.</p><p><strong>Filing Deadline:</strong> 10/28/2026 5:00:00 PM</p>"
  + "<p><strong>Salary:</strong> $67,309.00 - $106,155.00/year.</p>"
  + "<p><strong>Employment Type:</strong> <ul><li>Full-Time</li></ul></p>"
  + "<p><strong>Work Location:</strong> <ul><li>Baltimore City</li><li>Harford County</li></ul></p>";

test("a feed item becomes a job with its own id, department, place, pay and dates", () => {
  const xml = `<?xml version="1.0"?><rss><channel>${item("ACCOUNTANT II (Accountant II, General Accounting) - #26-004547-0006", ["26", "004547", "0006"], BODY)}</channel></rss>`;
  const [job] = parse(xml, Parser);
  assert.strictEqual(job.site, "jobaps");
  assert.strictEqual(job.job_id, "26-004547-0006");
  assert.strictEqual(job.title, "ACCOUNTANT II (Accountant II, General Accounting)");
  assert.strictEqual(job.company, "State of Maryland: LABOR - Family and Medical Leave Insurance");
  assert.strictEqual(job.location, "Baltimore City, Harford County, MD");
  assert.strictEqual(job.salary, "$67,309.00 - $106,155.00/year");
  assert.strictEqual(job.posted, "2026-10-14");
  assert.strictEqual(job.deadline, "2026-10-28");
  assert.strictEqual(job.employment_type, "Full-Time");
  assert.strictEqual(job.url, "https://www.jobapscloud.com/MD/sup/BulPreview.asp?R1=26&R2=004547&R3=0006");
  assert.match(job.description, /Salary: \$67,309/);
});

test("the placeholder application template and items without a link are skipped", () => {
  const xml = `<rss><channel>${item("Application Template - #AF-000000-001", ["AF", "000000", "001"], BODY)}
    <item><title>No link</title><description></description></item></channel></rss>`;
  assert.deepStrictEqual(parse(xml, Parser), []);
});

test("a job with no work location has none, and an empty feed gives no jobs", () => {
  const xml = `<rss><channel>${item("Clerk - #26-000001-0001", ["26", "000001", "0001"], "<p><strong>Department:</strong> MDE</p>")}</channel></rss>`;
  assert.strictEqual(parse(xml, Parser)[0].location, "");
  assert.deepStrictEqual(parse("", Parser), []);
});

// Run with: node --test tests/linkedin-parse.test.js
const test = require("node:test");
const assert = require("node:assert");
require("../extension/sites/linkedin-parse.js");

const parse = globalThis.LinkedInParse;

// Shaped like a Voyager "normalized" response: entities in "included", linked by URN.
const searchResponse = {
  data: { elements: [{ "*jobPostingCard": "urn:li:fsd_jobPostingCard:(4012345678,JOBS_SEARCH)" }] },
  included: [
    {
      $type: "com.linkedin.voyager.dash.jobs.JobPostingCard",
      entityUrn: "urn:li:fsd_jobPostingCard:(4012345678,JOBS_SEARCH)",
      jobPostingTitle: "Web Designer",
      title: { text: "Web Designer" },
      primaryDescription: { text: "Acme Corp" },
      secondaryDescription: { text: "Austin, TX (Hybrid)" },
      tertiaryDescription: { text: "$70K/yr - $85K/yr" },
    },
    {
      $type: "com.linkedin.voyager.dash.jobs.JobPosting",
      entityUrn: "urn:li:fsd_jobPosting:4012345678",
      title: "Web Designer",
      listedAt: 1727700000000,
    },
    {
      $type: "com.linkedin.voyager.dash.jobs.JobPostingRelevanceInsight",
      entityUrn: "urn:li:fsd_jobPostingRelevanceInsight:4012345678",
      title: { text: "Your profile matches several skills" },
    },
    {
      $type: "com.linkedin.voyager.dash.jobs.JobPostingCard",
      entityUrn: "urn:li:fsd_jobPostingCard:(4099999999,JOBS_SEARCH)",
      title: { text: "UX Designer" },
      primaryDescription: { text: "Beta LLC" },
    },
  ],
};

test("reads job cards from a search response", () => {
  const jobs = parse.fromVoyager(searchResponse, "https://www.linkedin.com/jobs/search-results/?keywords=designer");
  assert.strictEqual(jobs.length, 2);
  const job = jobs.find((item) => item.job_id === "4012345678");
  assert.strictEqual(job.title, "Web Designer");
  assert.strictEqual(job.company, "Acme Corp");
  assert.strictEqual(job.location, "Austin, TX (Hybrid)");
  assert.strictEqual(job.salary, "$70K/yr - $85K/yr");
  assert.strictEqual(job.work_arrangement, "Hybrid");
  assert.strictEqual(job.posted, "2024-09-30");
  assert.strictEqual(job.url, "https://www.linkedin.com/jobs/view/4012345678");
  assert.strictEqual(job.level, "seen");
  assert.strictEqual(job.page_kind, "search");
  const other = jobs.find((item) => item.job_id === "4099999999");
  assert.strictEqual(other.location, "");
});

test("reads a job's details, company, workplace type and closed state", () => {
  const detail = {
    included: [
      { entityUrn: "urn:li:fsd_company:555", name: "Acme Corp" },
      {
        entityUrn: "urn:li:fsd_jobPosting:4012345678",
        title: "Web Designer",
        formattedLocation: "Austin, TX",
        companyDetails: { jobCompany: { "*companyResolutionResult": "urn:li:fsd_company:555" } },
        workplaceTypes: ["urn:li:fsd_workplaceType:2"],
        jobState: "CLOSED",
      },
      {
        entityUrn: "urn:li:fsd_jobDescription:4012345678",
        descriptionText: { text: "We are hiring a web designer. ".repeat(10) },
      },
    ],
  };
  const [job] = parse.fromVoyager(detail, "https://www.linkedin.com/jobs/view/4012345678/");
  assert.strictEqual(job.company, "Acme Corp");
  assert.strictEqual(job.work_arrangement, "Remote");
  assert.strictEqual(job.level, "opened");
  assert.strictEqual(job.closed, true);
  assert.strictEqual(job.page_kind, "other");
});

test("notices jobs you already applied to", () => {
  const response = {
    included: [
      {
        entityUrn: "urn:li:fsd_jobPostingCard:(4011111111,JOBS_SEARCH)",
        title: { text: "Web Designer" },
        primaryDescription: { text: "Acme Corp" },
        footerItems: [{ type: "APPLIED", timeAt: 1727700000000 }],
      },
      {
        entityUrn: "urn:li:fsd_jobPosting:4022222222",
        title: "UX Designer",
        applyingInfo: { applied: true, appliedAt: 1727700000000 },
      },
      { entityUrn: "urn:li:fsd_jobPostingCard:(4033333333,JOBS_SEARCH)", title: { text: "UI Designer" } },
    ],
  };
  const applied = Object.fromEntries(parse.fromVoyager(response, "").map((job) => [job.job_id, job.applied]));
  assert.deepStrictEqual(applied, { 4011111111: true, 4022222222: true, 4033333333: false });
});

test("ignores responses without jobs", () => {
  assert.deepStrictEqual(parse.fromVoyager({ included: [{ entityUrn: "urn:li:fsd_profile:1", title: "x" }] }, ""), []);
});

test("job IDs from links and page kinds", () => {
  assert.strictEqual(parse.idFromUrl("/jobs/view/web-designer-at-acme-4012345678/?refId=x"), "4012345678");
  assert.strictEqual(parse.idFromUrl("/jobs/view/4012345678/"), "4012345678");
  assert.strictEqual(parse.idFromUrl("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678"), "4012345678");
  assert.strictEqual(parse.pageKind("https://www.linkedin.com/jobs/collections/recommended/"), "recommendation");
  assert.strictEqual(parse.pageKind("https://www.linkedin.com/jobs/"), "recommendation");
  assert.strictEqual(parse.pageKind("https://www.linkedin.com/jobs/search/?keywords=x"), "search");
  assert.strictEqual(parse.expectsJobs("https://www.linkedin.com/jobs/view/1/"), true);
  assert.strictEqual(parse.expectsJobs("https://www.linkedin.com/feed/"), false);
});

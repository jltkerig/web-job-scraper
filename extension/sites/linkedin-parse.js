// Reads LinkedIn jobs from two places:
//   1. the JSON LinkedIn loads in the background (Voyager API responses, and the JSON embedded
//      in the first page load). This works whatever the search page looks like (classic or AI search).
//   2. the visible page, as a fallback when the JSON can't be read.
// Used by background.js (network JSON) and content/linkedin.js (embedded JSON + page).
(function (root) {
  "use strict";

  const SITE = "linkedin";
  // urn:li:fsd_jobPosting:4012345678, urn:li:fsd_jobPostingCard:(4012345678,JOBS_SEARCH),
  // urn:li:fs_normalized_jobPosting:4012345678, urn:li:fsd_jobDescription:4012345678
  const JOB_URN = /job(?:Posting|Description)\w*:\(?(\d{6,})/i;
  // Only the posting itself and its list card name the job; other job-linked entities
  // (insights, apply info) can carry their own "title" text.
  const MAIN_URN = /jobPosting(?:Card)?:\(?\d/i;
  const COMPANY_URN = /^urn:li:(?:fsd_company|fs_normalized_company|company):/;
  const WORKPLACE = { 1: "On-site", 2: "Remote", 3: "Hybrid" };
  const CLOSED_TEXT = /no longer accepting applications|this job is no longer available|job has expired/i;
  // "Applied", "Applied 3 days ago", "Application submitted" on a card or the job's page.
  const APPLIED_LINE = /^applied\b/i;
  const APPLIED_TEXT = /\bapplied\s+\d+\s+\w+\s+ago\b|\bapplication submitted\b|\byou applied\b/i;
  const PAY_TEXT =/[$£€]\s?\d|\d\s?(?:k|K)\s?\/\s?(?:yr|year)|\/\s?(?:hr|hour|yr|year)\b/;

  function jobUrl(id) {
    return `https://www.linkedin.com/jobs/view/${id}`;
  }

  function idFromUrn(value) {
    const match = typeof value === "string" && value.match(JOB_URN);
    return match ? match[1] : null;
  }

  function idFromUrl(href) {
    if (!href) return null;
    const view = String(href).match(/\/jobs\/view\/(?:[^/?#]*?-)?(\d{6,})/);
    if (view) return view[1];
    const current = String(href).match(/[?&]currentJobId=(\d{6,})/);
    return current ? current[1] : null;
  }

  // What kind of page a job was found on, so job-finder can tell recommendations from searches.
  function pageKind(pageUrl) {
    let path = "";
    try {
      path = new URL(pageUrl).pathname.toLowerCase();
    } catch (error) {
      return "other";
    }
    if (path.includes("search")) return "search";
    if (path.startsWith("/jobs/collections") || path === "/jobs" || path === "/jobs/") return "recommendation";
    return "other";
  }

  function textOf(value) {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object" && typeof value.text === "string") return value.text.trim();
    return "";
  }

  function isoDate(value) {
    const number = Number(value);
    if (!number || number < 1e11) return "";
    return new Date(number).toISOString().slice(0, 10);
  }

  function arrangementFromText(text) {
    const match = String(text || "").match(/\b(remote|hybrid|on-site|onsite)\b/i);
    if (!match) return "";
    const word = match[1].toLowerCase();
    return word === "remote" ? "Remote" : word === "hybrid" ? "Hybrid" : "On-site";
  }

  function* walk(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 12) return;
    if (Array.isArray(value)) {
      for (const item of value) yield* walk(item, depth + 1);
      return;
    }
    yield value;
    for (const key of Object.keys(value)) yield* walk(value[key], depth + 1);
  }

  function companyName(entity, byUrn) {
    const direct = textOf(entity.companyName) || textOf(entity.primaryDescription);
    if (direct) return direct;
    for (const node of walk(entity.companyDetails || entity.company || null)) {
      if (typeof node.name === "string" && node.name.trim()) return node.name.trim();
      for (const value of Object.values(node)) {
        if (typeof value === "string" && COMPANY_URN.test(value) && byUrn.has(value)) {
          const name = textOf(byUrn.get(value).name);
          if (name) return name;
        }
      }
    }
    return "";
  }

  function workplace(entity) {
    const types = entity.workplaceTypes || entity["*workplaceTypes"] || entity.workplaceTypesResolutionResults;
    const values = Array.isArray(types) ? types : types && typeof types === "object" ? Object.keys(types) : [];
    for (const value of values) {
      const urn = typeof value === "string" ? value : value && value.entityUrn;
      const match = String(urn || "").match(/workplaceType:(\d)/);
      if (match && WORKPLACE[match[1]]) return WORKPLACE[match[1]];
    }
    if (entity.workRemoteAllowed === true) return "Remote";
    return "";
  }

  // LinkedIn marks jobs you applied to in the job's apply info or with an "Applied" footer on its card.
  function appliedTo(entity) {
    const info = entity.applyingInfo || {};
    if (entity.applied === true || entity.appliedAt || info.applied === true || info.appliedAt) return true;
    const footers = Array.isArray(entity.footerItems) ? entity.footerItems : [];
    return footers.some((item) => item && /APPLIED/i.test(String(item.type || "")));
  }

  function payText(entity) {
    for (const key of ["tertiaryDescription", "salary", "formattedSalary", "salaryText"]) {
      const text = textOf(entity[key]);
      if (text && PAY_TEXT.test(text)) return text;
    }
    return "";
  }

  function blank(id) {
    return {
      site: SITE, job_id: id, url: jobUrl(id), title: "", company: "", location: "", salary: "",
      work_arrangement: "", posted: "", description: "", closed: false, applied: false,
    };
  }

  function fill(job, field, value) {
    if (value && !job[field]) job[field] = value;
  }

  function finish(jobs, pageUrl) {
    const kind = pageKind(pageUrl);
    const result = [];
    for (const job of jobs.values()) {
      if (!job.title && !job.description) continue;
      job.work_arrangement = job.work_arrangement || arrangementFromText(job.location);
      job.level = job.description ? "opened" : "seen";
      job.page_kind = kind;
      result.push(job);
    }
    return result;
  }

  // Jobs from a Voyager JSON document (normalized "included" entities or nested GraphQL data).
  function fromVoyager(json, pageUrl) {
    const byUrn = new Map();
    for (const node of walk(json)) {
      if (typeof node.entityUrn === "string") byUrn.set(node.entityUrn, node);
    }
    const jobs = new Map();
    for (const [urn, entity] of byUrn) {
      const id = idFromUrn(urn);
      if (!id) continue;
      const job = jobs.get(id) || blank(id);
      jobs.set(id, job);
      if (MAIN_URN.test(urn)) {
        fill(job, "title", textOf(entity.title) || textOf(entity.jobPostingTitle));
        fill(job, "company", companyName(entity, byUrn));
        fill(job, "location", textOf(entity.formattedLocation) || textOf(entity.secondaryDescription));
        fill(job, "salary", payText(entity));
        fill(job, "work_arrangement", workplace(entity));
        fill(job, "posted", isoDate(entity.listedAt || entity.originalListedAt || entity.listedAtTimestamp));
      }
      const description = textOf(entity.descriptionText) || textOf(entity.description) || textOf(entity.jobDescription);
      if (description.length > 150) fill(job, "description", description);
      const state = String(entity.jobState || "").toUpperCase();
      if (state === "CLOSED" || entity.closed === true || (entity.applyingInfo && entity.applyingInfo.closed === true)) {
        job.closed = true;
      }
      if (appliedTo(entity)) job.applied = true;
    }
    return finish(jobs, pageUrl);
  }

  function lines(element) {
    const seen = new Set();
    return String(element.innerText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !seen.has(line) && seen.add(line));
  }

  // The job details pane (search/recommendation pages) or the job's own page.
  function detailFromDom(doc, pageUrl) {
    const id = idFromUrl(pageUrl);
    if (!id) return null;
    const job = blank(id);
    const description = doc.querySelector(
      "#job-details, [class*='jobs-description__content'], [class*='jobs-description-content'], [class*='job-details-module']");
    let region = description;
    if (!region) {
      const heading = Array.from(doc.querySelectorAll("h2, h3")).find((node) => /about the job/i.test(node.innerText || ""));
      region = heading && heading.parentElement;
    }
    const text = region ? String(region.innerText || "").replace(/^\s*about the job\s*/i, "").trim() : "";
    if (text.length > 150) job.description = text;
    const titleNode = doc.querySelector(
      "[class*='top-card__job-title'], [class*='unified-top-card__job-title'], [class*='job-title'] h1, main h1");
    job.title = titleNode ? lines(titleNode)[0] || "" : "";
    const pane = (titleNode && titleNode.closest("section, div[class*='top-card']")) || null;
    if (pane) {
      const paneLines = lines(pane).filter((line) => line !== job.title);
      job.company = paneLines[0] || "";
      const place = paneLines.find((line, index) => index > 0 && /,|remote|united states/i.test(line));
      job.location = place ? place.split("·")[0].trim() : "";
      job.salary = paneLines.find((line) => PAY_TEXT.test(line)) || "";
      job.work_arrangement = arrangementFromText(paneLines.join(" "));
    }
    const top = (pane && pane.parentElement) || doc.body;
    const topText = String(top.innerText || "").slice(0, 5000);
    job.closed = CLOSED_TEXT.test(topText);
    job.applied = APPLIED_TEXT.test(topText);
    return job.title || job.description ? job : null;
  }

  // Job cards in lists: anything linking to /jobs/view/<id>.
  function fromDom(doc, pageUrl) {
    const jobs = new Map();
    for (const link of doc.querySelectorAll("a[href*='/jobs/view/']")) {
      const id = idFromUrl(link.getAttribute("href"));
      if (!id || jobs.has(id)) continue;
      const job = blank(id);
      job.title = lines(link)[0] || textOf(link.getAttribute("aria-label"));
      const card = link.closest("li, [data-job-id], [data-occludable-job-id]");
      const cardIds = card ? new Set(Array.from(card.querySelectorAll("a[href*='/jobs/view/']"),
        (node) => idFromUrl(node.getAttribute("href")))) : new Set();
      if (card && cardIds.size === 1) {
        const rest = lines(card).filter((line) => line !== job.title && !line.startsWith(job.title));
        job.company = rest[0] || "";
        const place = rest.find((line, index) => index > 0 && /,|remote|united states|\((?:hybrid|on-site)\)/i.test(line));
        job.location = place || "";
        job.salary = rest.find((line) => PAY_TEXT.test(line)) || "";
        job.applied = rest.some((line) => APPLIED_LINE.test(line));
      }
      if (job.title) jobs.set(id, job);
    }
    const detail = detailFromDom(doc, pageUrl);
    if (detail) {
      const card = jobs.get(detail.job_id);
      if (card) {
        for (const field of Object.keys(detail)) {
          if (detail[field] && (!card[field] || field === "description")) card[field] = detail[field];
        }
      } else {
        jobs.set(detail.job_id, detail);
      }
    }
    return finish(jobs, pageUrl);
  }

  // The JSON LinkedIn embeds in the first page load (<code id="bpr-guid-..."> blocks).
  function fromEmbedded(doc, pageUrl, done) {
    const jobs = [];
    for (const node of doc.querySelectorAll("code[id^='bpr-guid'], code[id*='datalet']")) {
      if (done && done.has(node)) continue;
      if (done) done.add(node);
      const text = node.textContent || "";
      if (!text.includes("obPosting")) continue;
      try {
        jobs.push(...fromVoyager(JSON.parse(text), pageUrl));
      } catch (error) {
        // Not JSON, or not job data.
      }
    }
    return jobs;
  }

  // Jobs pages where the extension expects to find jobs (used by the capture health check).
  function expectsJobs(pageUrl) {
    try {
      const path = new URL(pageUrl).pathname.toLowerCase();
      return path === "/jobs" || path === "/jobs/" || path.startsWith("/jobs/view/") ||
        path.startsWith("/jobs/search") || path.startsWith("/jobs/collections");
    } catch (error) {
      return false;
    }
  }

  root.LinkedInParse = { SITE, jobUrl, idFromUrl, pageKind, fromVoyager, fromDom, fromEmbedded, expectsJobs, CLOSED_TEXT };
})(typeof globalThis !== "undefined" ? globalThis : this);

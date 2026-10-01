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
  // Pay with a rate ("$78K/yr", "$38/hr - $40/hr", "$70,000 - $90,000"), not a one-off amount like a sign-on bonus.
  const PAY_TEXT = /[$£€]\s?\d[\d,.]*\s?[Kk]?\s?\/\s?(?:yr|year|hr|hour|mo|month|wk|week)\b|[$£€]\s?\d[\d,.]*\s?[Kk]?\s?[-–]\s?[$£€]?\s?\d/;

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

  // The element's text, one entry per text node (LinkedIn puts each label in its own element). Repeats, such as
  // the copies LinkedIn adds for screen readers, are dropped unless { unique: false }.
  const SKIP_TEXT_IN = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

  function lines(element, { unique = true } = {}) {
    const seen = new Set();
    const result = [];
    const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement && SKIP_TEXT_IN.has(node.parentElement.tagName)) continue;
      const line = node.nodeValue.replace(/\s+/g, " ").trim();
      if (!line || (unique && seen.has(line))) continue;
      seen.add(line);
      result.push(line);
    }
    return result;
  }

  // LinkedIn's 2026 pages have scrambled class names and no stable ids, so everything below goes by the page's text:
  // the "About the job" heading, the order of the lines at the top of a job, and the lines inside each job link.
  const LOCATION_LINE = /,\s*[A-Z]{2}\b|\bremote\b|united states|metropolitan area|\barea\b|^greater\s/i;
  const WORKPLACE_LINE = /^(on-site|onsite|remote|hybrid)$/i;
  const COMPANY_CARD_LINE = /\b[\d,.+-]+[KkMm]?\s+(?:employees|followers)\b/;
  const POSTED_LINE =/^(?:re)?posted\b|^\d+\s+\w+\s+ago$/i;

  // LinkedIn adds badges to titles: "Web Designer (Verified job)", "Web Designer with verification".
  function cleanTitle(line) {
    return String(line || "").replace(/\s*\(verified job\)\s*$/i, "").replace(/\s+with verification$/i, "").trim();
  }

  // The first line that looks like a place, preferring one followed by LinkedIn's "·" separator.
  function locationIndex(list, from) {
    const places = [];
    for (let i = from; i < list.length; i += 1) {
      if (LOCATION_LINE.test(list[i]) && list[i].length < 80 && !WORKPLACE_LINE.test(list[i])) places.push(i);
    }
    return places.find((i) => list[i + 1] === "·") ?? (places.length ? places[0] : -1);
  }

  // The job details pane (search/recommendation pages) or the job's own page.
  function detailFromDom(doc, pageUrl) {
    const id = idFromUrl(pageUrl);
    if (!id) return null;
    const job = blank(id);
    const heading = Array.from(doc.querySelectorAll("h1, h2, h3"))
      .find((node) => /^\s*about the job\s*$/i.test(node.textContent || ""));
    let header = [];
    if (heading) {
      // The description: the nearest box around the heading that holds real text.
      let box = heading.parentElement;
      while (box && (box.textContent || "").trim().length < 200) box = box.parentElement;
      if (box) {
        const text = lines(box).filter((line) => !/^about the job$/i.test(line)).join("\n");
        if (text.length > 150) job.description = text.slice(0, 20000);
      }
      // The top of the job: company, title, location, "·", "Reposted 2 weeks ago", ..., "On-site", "Applied ...".
      let scope = heading.parentElement;
      for (let depth = 0; scope && depth < 20; depth += 1, scope = scope.parentElement) {
        const all = lines(scope, { unique: false });
        const stop = all.findIndex((line) => /^about the job$/i.test(line));
        const before = stop >= 0 ? all.slice(0, stop) : all;
        const at = locationIndex(before, 2);
        if (at >= 2) {
          job.location = before[at];
          job.title = cleanTitle(before[at - 1]);
          job.company = before[at - 2];
          header = before.slice(at - 2);
          break;
        }
      }
    }
    // A job's own page is titled "Title | Company | LinkedIn".
    const parts = String(doc.title || "").split(" | ");
    if (/\/jobs\/view\//.test(pageUrl) && parts.length >= 3 && /linkedin/i.test(parts[parts.length - 1])) {
      job.title = cleanTitle(parts[0]);
      job.company = parts[1].trim();
    }
    const place = header.find((line) => WORKPLACE_LINE.test(line));
    job.work_arrangement = place ? arrangementFromText(place) : arrangementFromText(job.location);
    job.salary = header.find((line) => PAY_TEXT.test(line)) || "";
    job.posted = header.find((line) => POSTED_LINE.test(line)) || "";
    job.applied = header.some((line) => APPLIED_LINE.test(line) || APPLIED_TEXT.test(line));
    job.closed = header.some((line) => CLOSED_TEXT.test(line));
    return job.title || job.description ? job : null;
  }

  // Job cards in lists: links to /jobs/view/<id> or to a list with currentJobId=<id>. In the 2026 layout the link
  // wraps the whole card: title, company, location, then pay, benefits, "Promoted", "Applied".
  function fromDom(doc, pageUrl) {
    const jobs = new Map();
    for (const link of doc.querySelectorAll("a[href*='/jobs/view/'], a[href*='currentJobId=']")) {
      const id = idFromUrl(link.getAttribute("href"));
      if (!id || jobs.has(id)) continue;
      // Only links into the Jobs section are job cards; others (messaging a contact "about this job") only mention it.
      let path = "";
      try {
        path = new URL(link.getAttribute("href"), pageUrl).pathname;
      } catch (error) {
        continue;
      }
      if (!path.startsWith("/jobs")) continue;
      let card = lines(link);
      if (card.length < 2) {
        // Older layout: the link holds only the title and the card is its list item.
        const box = link.closest("li, [data-job-id], [data-occludable-job-id]");
        const ids = box ? new Set(Array.from(box.querySelectorAll("a[href*='/jobs/view/'], a[href*='currentJobId=']"),
          (node) => idFromUrl(node.getAttribute("href")))) : new Set();
        if (box && ids.size === 1) card = lines(box);
      }
      // A lone "On-site" link (the work-place tag on a job's own page) is not a card, and neither is a company card
      // ("201-500 employees", "12K followers").
      if (card.length < 2 || WORKPLACE_LINE.test(card[0]) || card.some((line) => COMPANY_CARD_LINE.test(line))) continue;
      const job = blank(id);
      job.title = cleanTitle(card[0]);
      job.company = card[1];
      const at = locationIndex(card, 2);
      job.location = at >= 0 ? card[at] : "";
      job.salary = card.find((line) => PAY_TEXT.test(line)) || "";
      job.applied = card.some((line) => APPLIED_LINE.test(line));
      job.closed = card.some((line) => CLOSED_TEXT.test(line));
      jobs.set(id, job);
    }
    const detail = detailFromDom(doc, pageUrl);
    if (detail) {
      const card = jobs.get(detail.job_id);
      if (card) {
        // The job's own header is the better source; the card only fills in what the header lacks.
        for (const field of Object.keys(detail)) {
          if (detail[field]) card[field] = detail[field];
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

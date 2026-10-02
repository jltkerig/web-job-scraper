// Reads USAJOBS (usajobs.gov) search results and job pages that you open yourself. The site blocks automated
// visitors, so the extension only reads what you browse; it never fetches pages. A search page lists each job in a
// "page-section" box: title link (/job/<number>), "Agency • Department", the work place, the open dates and pay badges.
// Used by content/capture.js and background.js.
(function (root) {
  "use strict";

  const SITE = "usajobs";
  const STATES = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
    Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
    Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME",
    Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO",
    Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
    Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN",
    Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
    Wisconsin: "WI", Wyoming: "WY",
  };
  const JOB_PATH = /\/job\/(\d+)/;
  const OPEN_DATES = /^open\s+(\d{2})\/(\d{2})\/(\d{4})(?:\s+to\s+(\d{2})\/(\d{2})\/(\d{4}))?/i;

  function idFromUrl(pageUrl) {
    const match = String(pageUrl || "").match(JOB_PATH);
    return match ? match[1] : null;
  }

  function isDetailPage(pageUrl) {
    return JOB_PATH.test(String(pageUrl || ""));
  }

  function expectsJobs(pageUrl) {
    return isDetailPage(pageUrl) || /\/search\/results/i.test(String(pageUrl || ""));
  }

  function onJobsPage(loc) {
    return /^\/(?:search|job)(?:\/|$)/i.test(loc.pathname);
  }

  function pageKind(pageUrl) {
    return isDetailPage(pageUrl) ? "other" : "search";
  }

  function jobUrl(id) {
    return `https://www.usajobs.gov/job/${id}`;
  }

  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();

  // "Cannon AFB, New Mexico + 1 location(s)" -> "Cannon AFB, NM"; a state name becomes its two-letter code.
  function place(text) {
    const first = clean(text).replace(/\s*\+\s*\d+\s*location\(s\)\s*$/i, "");
    const at = first.lastIndexOf(",");
    if (at < 0) return first;
    const state = first.slice(at + 1).trim();
    return STATES[state] ? `${first.slice(0, at)}, ${STATES[state]}` : first;
  }

  // "Starting at $63,940 Per year (GS 8-13)" -> "$63,940/year (GS 8-13)"
  function pay(text) {
    return clean(text).replace(/^starting at\s*/i, "").replace(/\s+per\s+(year|hour|week|month)(?=\s|$)/i, "/$1");
  }

  function job(fields, pageUrl) {
    const record = {
      site: SITE, title: "", company: "", location: "", salary: "", work_arrangement: "", posted: "", description: "",
      closed: false, applied: false, url: pageUrl, job_id: idFromUrl(pageUrl) || "", ...fields,
    };
    record.title = record.title.trim();
    record.level = record.description.length > 150 ? "opened" : "seen";
    record.page_kind = pageKind(pageUrl);
    return record;
  }

  function cardsFromDom(doc, pageUrl) {
    const jobs = [];
    const seen = new Set();
    for (const link of doc.querySelectorAll("h2 a[href*='/job/']")) {
      const id = idFromUrl(link.getAttribute("href"));
      const card = link.closest(".page-section");
      if (!id || !card || seen.has(id)) continue;
      seen.add(id);
      const org = Array.from(card.querySelectorAll("strong")).find((node) => node.parentElement && node.parentElement.textContent.includes("•"));
      const [agency, department] = (org ? clean(org.parentElement.textContent) : "").split("•").map(clean);
      const pin = Array.from(card.querySelectorAll("use")).find((node) => /#location_on$/.test(node.getAttribute("xlink:href") || node.getAttribute("href") || ""));
      const range = Array.from(card.querySelectorAll("span")).map((node) => clean(node.textContent)).map((text) => text.match(OPEN_DATES)).find(Boolean);
      const end = range && range[4] ? new Date(Number(range[6]), Number(range[4]) - 1, Number(range[5]), 23, 59, 59) : null;
      const money = Array.from(card.querySelectorAll(".badge-secondary")).map((node) => clean(node.textContent)).find((text) => text.includes("$")) || "";
      let url = jobUrl(id);
      try {
        url = new URL(link.getAttribute("href"), pageUrl).href.split("?")[0];
      } catch (error) {
        // keep the standard job address
      }
      jobs.push(job({
        job_id: id, title: clean(link.textContent), company: agency || department || "",
        location: pin ? place(pin.closest("div").textContent) : "",
        salary: pay(money), posted: range ? `${range[3]}-${range[1]}-${range[2]}` : "",
        closed: Boolean(end && end.getTime() < Date.now()), url,
      }, pageUrl));
    }
    return jobs;
  }

  // The text lines of an element, in order.
  function lines(element) {
    const result = [];
    const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement && /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.parentElement.tagName)) continue;
      const line = clean(node.nodeValue);
      if (line) result.push(line);
    }
    return result;
  }

  // The line after a label in the Overview box ("Salary", then "$57,675 - $114,825 per year").
  function after(list, label) {
    const at = list.findIndex((line) => line.toLowerCase() === label.toLowerCase());
    return at >= 0 && at + 1 < list.length ? list[at + 1] : "";
  }

  // A job page: the banner holds the title and agency, the Overview box the place, pay and dates, and the
  // Summary, Duties and Requirements sections the description.
  function detailFromDom(doc, pageUrl) {
    const text = (selector) => clean((doc.querySelector(selector) || {}).textContent);
    const title = text(".usajobs-joa-banner__title") || text("h1");
    if (!title) return null;
    const main = doc.querySelector("main") || doc.body;
    const overview = lines(main);
    const agency = text(".usajobs-joa-banner__agency") || text(".usajobs-joa-banner__dept");
    const at = overview.findIndex((line) => /^\d+ vacanc(?:y|ies) in the following location/i.test(line));
    const where = at >= 0 ? overview[at + 1] : "";
    const range = overview.map((line) => line.match(OPEN_DATES)).find(Boolean);
    const end = range && range[4] ? new Date(Number(range[6]), Number(range[4]) - 1, Number(range[5]), 23, 59, 59) : null;
    const sections = ["#joa-summary", "#joa-duties", "#joa-requirements"]
      .map((selector) => doc.querySelector(selector)).filter(Boolean)
      .map((node) => lines(node).join("\n"));
    const salary = after(overview, "Salary");
    const remote = /^yes$/i.test(after(overview, "Remote job"));
    const telework = /^yes$/i.test(after(overview, "Telework eligible"));
    return job({
      title, company: agency, location: place(where), salary: pay(salary),
      posted: range ? `${range[3]}-${range[1]}-${range[2]}` : "",
      work_arrangement: remote ? "Remote" : telework ? "Hybrid" : "",
      closed: Boolean(end && end.getTime() < Date.now()) || overview.some((line) => /^(?:closed|this job announcement is closed)$/i.test(line)),
      description: sections.join("\n\n").slice(0, 20000),
    }, pageUrl);
  }

  function fromDom(doc, pageUrl) {
    if (isDetailPage(pageUrl)) {
      const detail = detailFromDom(doc, pageUrl);
      return detail ? [detail] : [];
    }
    return cardsFromDom(doc, pageUrl);
  }

  function detailId(pageUrl, jobs) {
    return isDetailPage(pageUrl) && jobs.length === 1 ? jobs[0].job_id : null;
  }

  root.UsajobsParse = { SITE, NAME: "USAJOBS", jobUrl, idFromUrl, fromDom, expectsJobs, onJobsPage, pageKind, detailId, place };
  root.CaptureParse = root.UsajobsParse;
})(typeof globalThis !== "undefined" ? globalThis : this);

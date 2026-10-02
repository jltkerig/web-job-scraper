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

  // A job page: the title is the page's main heading. This layout has not been seen yet, so it is read loosely.
  function detailFromDom(doc, pageUrl) {
    const heading = doc.querySelector("h1");
    const title = heading ? clean(heading.textContent) : "";
    if (!title) return null;
    const text = clean((doc.querySelector("main") || doc.body).textContent);
    return job({
      title, description: text.slice(0, 20000),
      closed: /announcement (?:has )?closed|no longer accepting/i.test(text),
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

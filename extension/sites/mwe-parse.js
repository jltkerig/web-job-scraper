// Reads Maryland Workforce Exchange jobs (mwejobs.maryland.gov) from pages you open yourself. The site's rules
// (robots.txt) don't allow automated visitors, so the extension only reads what you browse; it never fetches pages.
// Job pages carry a long encrypted link (jobdetails.aspx?enc=...) that isn't a stable id, so a job is known by its
// title, employer and place. Used by content/capture.js and background.js.
(function (root) {
  "use strict";

  const SITE = "mwe";
  const LOCATION_LINE = /,\s*[A-Z]{2}\b|\bremote\b|united states/i;
  const LABEL = /^(employer|company|employer name|location|job location|posted|date posted|posting date|salary|wage|job (?:order )?(?:id|number)|mwe job id)\s*:?$/i;
  const CLOSED_TEXT = /this job (?:order )?(?:is|has been) (?:closed|filled|expired)|no longer (?:available|accepting)/i;

  function isDetailPage(pageUrl) {
    return /\/jobbanks\/jobdetails\.aspx/i.test(String(pageUrl || ""));
  }

  // Job search and job pages: where jobs are expected (used by the capture health check).
  function expectsJobs(pageUrl) {
    return isDetailPage(pageUrl) || /\/jobbanks\/(?:joblist|jobsearch|searchresults)/i.test(String(pageUrl || ""));
  }

  function onJobsPage(loc) {
    return /\/vosnet\//i.test(loc.pathname);
  }

  function pageKind(pageUrl) {
    return isDetailPage(pageUrl) ? "other" : "search";
  }

  // A short stable id from the job's title, employer and place (FNV-1a, hex).
  function jobKey(title, company, location) {
    const text = [title, company, location].map((part) => String(part || "").toLowerCase().replace(/\s+/g, " ").trim()).join("|");
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

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

  // Text of an HTML description. DOMParser builds an inert document: no scripts run and no images load.
  function plain(html, doc) {
    const view = (doc && doc.defaultView) || root;
    if (!view.DOMParser) return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const parsed = new view.DOMParser().parseFromString(String(html || ""), "text/html");
    return (parsed.body.textContent || "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  }

  function job(fields, pageUrl) {
    const record = {
      site: SITE, title: "", company: "", location: "", salary: "", work_arrangement: "", posted: "", description: "",
      closed: false, applied: false, url: pageUrl, ...fields,
    };
    record.title = record.title.trim();
    record.job_id = jobKey(record.title, record.company, record.location);
    record.level = record.description.length > 150 ? "opened" : "seen";
    record.page_kind = pageKind(pageUrl);
    if (!record.work_arrangement && /\bremote\b|telework|telecommut/i.test(`${record.title} ${record.location}`)) {
      record.work_arrangement = "Remote";
    }
    return record;
  }

  // ---------- the job data most job sites include for search engines (schema.org JobPosting) ----------

  function* nodes(value) {
    if (Array.isArray(value)) {
      for (const item of value) yield* nodes(item);
    } else if (value && typeof value === "object") {
      yield value;
      if (value["@graph"]) yield* nodes(value["@graph"]);
    }
  }

  function fromJsonLd(doc, pageUrl) {
    const jobs = [];
    for (const script of doc.querySelectorAll("script[type='application/ld+json']")) {
      let data;
      try {
        data = JSON.parse(script.textContent || "");
      } catch (error) {
        continue;
      }
      for (const node of nodes(data)) {
        const types = [].concat(node["@type"] || []).map(String);
        if (!types.includes("JobPosting")) continue;
        const places = [].concat(node.jobLocation || []).map((place) => (place && place.address) || {});
        const first = places[0] || {};
        const location = [first.addressLocality, first.addressRegion].filter(Boolean).join(", ");
        const pay = node.baseSalary && node.baseSalary.value ? node.baseSalary.value : null;
        const salary = pay && (pay.minValue || pay.value)
          ? `$${pay.minValue || pay.value}${pay.maxValue ? ` - $${pay.maxValue}` : ""}${pay.unitText ? `/${String(pay.unitText).toLowerCase()}` : ""}`
          : "";
        const expired = node.validThrough && Date.parse(node.validThrough) < Date.now();
        jobs.push(job({
          title: String(node.title || ""), company: String((node.hiringOrganization || {}).name || ""), location,
          salary, posted: String(node.datePosted || "").slice(0, 10), description: plain(node.description, doc),
          work_arrangement: /TELECOMMUTE/i.test(String(node.jobLocationType || "")) ? "Remote" : "",
          closed: Boolean(expired), url: String(node.url || pageUrl),
        }, pageUrl));
      }
    }
    return jobs.filter((item) => item.title);
  }

  // ---------- the visible page ----------

  // The value after a label such as "Employer:" or "Location:" in the page's lines.
  function labelled(list, pattern) {
    for (let i = 0; i < list.length - 1; i += 1) {
      const line = list[i];
      const inline = line.match(new RegExp(`^(?:${pattern.source})\\s*:\\s*(.+)$`, "i"));
      if (inline) return inline[1].trim();
      if (new RegExp(`^(?:${pattern.source})\\s*:?$`, "i").test(line) && !LABEL.test(list[i + 1])) return list[i + 1];
    }
    return "";
  }

  function detailFromDom(doc, pageUrl) {
    const main = doc.querySelector("main, #content, #main, [role='main'], form") || doc.body;
    const all = lines(main, { unique: false });
    const heading = Array.from(main.querySelectorAll("h1, h2, h3"))
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .find((text) => text && !/^(job details|job search|search results|mwejobs)$/i.test(text) && text.length < 150);
    const title = heading || labelled(all, /job title|position( title)?/) || "";
    if (!title) return null;
    const company = labelled(all, /employer( name)?|company( name)?/);
    const location = labelled(all, /(?:job )?location|work site location/) || all.find((line) => LOCATION_LINE.test(line) && line.length < 60) || "";
    const at = all.findIndex((line) => /^(job )?description\s*:?$/i.test(line) || /^duties/i.test(line));
    const description = at >= 0 ? all.slice(at + 1, at + 120).join("\n") : "";
    const text = all.join("\n");
    return job({
      title, company, location, description: description.slice(0, 20000),
      posted: labelled(all, /posted|date posted|posting date/),
      salary: labelled(all, /salary|wage|pay/),
      closed: CLOSED_TEXT.test(text),
    }, pageUrl);
  }

  // Search results: each job is a link to jobdetails.aspx with the employer and place nearby.
  function cardsFromDom(doc, pageUrl) {
    const jobs = [];
    for (const link of doc.querySelectorAll("a[href*='jobdetails.aspx' i]")) {
      const title = lines(link)[0] || "";
      if (!title || /^(view|details|more)/i.test(title)) continue;
      const card = link.closest("tr, li, article, div[class*='job' i], div[class*='result' i]");
      const links = card ? card.querySelectorAll("a[href*='jobdetails.aspx' i]").length : 0;
      const rest = card && links <= 2 ? lines(card).filter((line) => line !== title) : [];
      const location = rest.find((line) => LOCATION_LINE.test(line) && line.length < 60) || "";
      const company = rest.find((line) => line !== location && !/^\d|posted|ago$|^(save|apply|view)/i.test(line)) || "";
      let url = pageUrl;
      try {
        url = new URL(link.getAttribute("href"), pageUrl).href;
      } catch (error) {
        // keep the page's own address
      }
      jobs.push(job({ title, company, location, url }, pageUrl));
    }
    return jobs;
  }

  function fromDom(doc, pageUrl) {
    const structured = fromJsonLd(doc, pageUrl);
    if (structured.length) return structured;
    if (isDetailPage(pageUrl)) {
      const detail = detailFromDom(doc, pageUrl);
      return detail ? [detail] : [];
    }
    return cardsFromDom(doc, pageUrl);
  }

  // The job open on this page, if it's a job page (used by the details health check).
  function detailId(pageUrl, jobs) {
    return isDetailPage(pageUrl) && jobs.length === 1 ? jobs[0].job_id : null;
  }

  root.MweParse = { SITE, NAME: "Maryland Workforce Exchange", fromDom, expectsJobs, onJobsPage, pageKind, detailId, jobKey };
  root.CaptureParse = root.MweParse;
})(typeof globalThis !== "undefined" ? globalThis : this);

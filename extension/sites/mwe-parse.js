// Reads Maryland Workforce Exchange jobs (mwejobs.maryland.gov) from pages you open yourself. The site's rules
// (robots.txt) don't allow automated visitors, so the extension only reads what you browse; it never fetches pages.
// Job pages carry a long encrypted link (jobdetails.aspx?enc=...) that isn't a stable id, so a job is known by its
// title, employer and place. Used by content/capture.js and background.js.
(function (root) {
  "use strict";

  const SITE = "mwe";
  const LOCATION_LINE = /,\s*[A-Z]{2}\b|\bremote\b|united states/i;
  const LABEL = /^(employer|company|employer name|location|job location|posted|date posted|posting date|salary|wage|job (?:order )?(?:id|number)|mwe job id)\s*:?$/i;
  // Words in a job's link or a page's headings that are not a job's title: a date, a button, a section name.
  const NOT_A_TITLE = /^(?:\d{1,2}\/\d{1,2}\/\d{2,4}|apply(?: now)?|view(?: details)?|details|more|save|job (?:summary|description|details|information|overview)|help for .*|e-?signature.*)$/i;
  // Page text that is not a company: the fit chart's explanation, or any long sentence.
  const NOT_A_COMPANY = /^(?:this chart is used|you match \d|\d|posted|save|apply|view)|ago$/i;
  const CLOSED_TEXT = /this job (?:order )?(?:is|has been) (?:closed|filled|expired)|no longer (?:available|accepting)/i;

  function isDetailPage(pageUrl) {
    return /\/jobbanks\/jobdetails\.aspx/i.test(String(pageUrl || ""));
  }

  // Job search and job pages: where jobs are expected (used by the capture health check).
  function expectsJobs(pageUrl) {
    // joblist.aspx is the results page. The search form (JobSearchCriteria*.aspx) has no jobs, so it must not raise the
    // "capture may be broken" warning.
    return isDetailPage(pageUrl) || /\/jobbanks\/(?:joblist|searchresults)/i.test(String(pageUrl || ""));
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

  // "Between $40k and $55k Per Year" is the page's own pay summary; else the posting's "Compensation:" line.
  function postedPay(list) {
    const at = list.findIndex((line) => /^between$/i.test(line));
    if (at >= 0 && list[at + 3] && /^\$/.test(list[at + 1])) return list[at + 1] + " - " + list[at + 3] + " " + (list[at + 4] || "");
    const comp = list.find((line) => /^compensation\s*:/i.test(line));
    return comp ? comp.replace(/^compensation\s*:\s*/i, "") : "";
  }

  function detailFromDom(doc, pageUrl) {
    const main = doc.querySelector("main, #content, #main, [role='main'], form") || doc.body;
    const all = lines(main, { unique: false });
    const heading = Array.from(main.querySelectorAll("h1, h2, h3"))
      .map((node) => node.textContent.replace(/\s+/g, " ").trim())
      .find((text) => text && !/^(job details|job search|search results|mwejobs)$/i.test(text) && !NOT_A_TITLE.test(text) && text.length < 150);
    const title = heading || labelled(all, /job title|position( title)?/) || "";
    if (!title) return null;
    // MWE job pages show the employer right under the title and again after "Source:"; "Employer" alone is a form label.
    const titleAt = all.indexOf(title);
    const below = titleAt >= 0 ? all[titleAt + 1] : "";
    const company = labelled(all, /source|employer( name)?|company( name)?/)
      || (below && below.length <= 80 && !/:$/.test(below) ? below : "");
    const location = labelled(all, /(?:job )?location|work site location/) || all.find((line) => LOCATION_LINE.test(line) && line.length < 60) || "";
    const at = all.findIndex((line) => /^(job )?description\s*:?$/i.test(line) || /^duties/i.test(line));
    const stop = all.findIndex((line, i) => i > at && /^employer research$/i.test(line));
    const description = at >= 0
      ? all.slice(at + 1, stop > at ? stop : at + 120).filter((line) => !/^help for .*opens a new window\.?$/i.test(line)).join("\n")
      : "";
    const text = all.join("\n");
    return job({
      title, company, location, description: description.slice(0, 20000),
      posted: labelled(all, /posted|date posted|posting date/),
      salary: labelled(all, /salary|wage|pay/) || postedPay(all),
      closed: CLOSED_TEXT.test(text),
    }, pageUrl);
  }

  // Search results as the site builds them (seen 2026-10-15): each job is a .JCardEmployerArea with its title link
  // (.JCardTitle, the searched word wrapped in a span), .JCardEmployer (the employer's name, then the town in
  // .JCardEmployerLocation), .JCardTypePay ("Regular | $65,000.00 Year") and .JCardDateCity ("6 days ago"). The job's
  // description starts is in the .JCardDescription next to it. The links are long encrypted addresses.
  function jobCards(doc, pageUrl) {
    const jobs = [];
    for (const link of doc.querySelectorAll("a.JCardTitle")) {
      const title = (link.textContent || "").replace(/\s+/g, " ").trim().replace(/[:\s]+$/, "");
      if (!title) continue;
      const area = link.closest(".JCardEmployerArea") || link.parentElement;
      const employer = area.querySelector(".JCardEmployer");
      const place = employer && employer.querySelector(".JCardEmployerLocation");
      const company = employer
        ? Array.from(employer.childNodes).filter((node) => node.nodeType === 3).map((node) => node.nodeValue.replace(/[\s ]+/g, " ").trim()).find((text) => text && !/^not available$/i.test(text)) || ""
        : "";
      const location = place ? place.textContent.replace(/[\s ]+/g, " ").trim() : "";
      const typePay = (area.querySelector(".JCardTypePay") || {}).textContent || "";
      const pay = typePay.match(/\$[\d,.]+(?:\.\d+)?\s*(?:-\s*\$[\d,.]+\s*)?(?:Year|Hour|Month|Week|Day)?/i);
      let url = pageUrl;
      try {
        url = new URL(link.getAttribute("href"), pageUrl).href;
      } catch (error) {
        // keep the page's own address
      }
      jobs.push(job({ title, company, location, url, salary: pay ? pay[0].replace(/\s+/g, " ").trim() : "" }, pageUrl));
    }
    return jobs;
  }

  // Any other results layout: each job is a link to jobdetails.aspx with the employer and place nearby.
  function cardsFromDom(doc, pageUrl) {
    const known = jobCards(doc, pageUrl);
    if (known.length) return known;
    const jobs = [];
    for (const link of doc.querySelectorAll("a[href*='jobdetails.aspx' i]")) {
      // The whole link's text: a searched word can be highlighted in its own element ("Graphic" + " Designer").
      const title = (link.textContent || "").replace(/\s+/g, " ").trim();
      if (!title || NOT_A_TITLE.test(title)) continue;
      const card = link.closest("tr, li, article, div[class*='job' i], div[class*='result' i]");
      // A row can link to its job three times (title, date, Apply): those are one job; two different jobs are two cards.
      const links = card ? new Set(Array.from(card.querySelectorAll("a[href*='jobdetails.aspx' i]"), (a) => a.getAttribute("href"))).size : 0;
      const rest = card && links <= 1 ? lines(card).filter((line) => line !== title) : [];
      const location = rest.find((line) => LOCATION_LINE.test(line) && line.length < 60) || "";
      const company = rest.find((line) => line !== location && line.length <= 80 && !NOT_A_COMPANY.test(line)
        && !title.includes(line)) || "";
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

  // Before 0.16.2 the reader saved the fit chart's explanation ("This chart is used to compare your background...") as the
  // employer. Records holding it are dropped on start-up and read again properly the next time the page is opened.
  function badCompany(text) {
    return /^this chart is used\b|\byou match (?:null|\d+)%/i.test(String(text || ""));
  }

  root.MweParse = { SITE, NAME: "Maryland Workforce Exchange", fromDom, expectsJobs, onJobsPage, pageKind, detailId, jobKey, badCompany };
  root.CaptureParse = root.MweParse;
})(typeof globalThis !== "undefined" ? globalThis : this);

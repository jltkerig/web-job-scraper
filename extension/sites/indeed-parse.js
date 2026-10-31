// Reads the jobs on the Indeed pages you open: search results and a job's own page.
//
// Indeed keeps its job data in script variables inside the page ("hidden web data": the same data as the visible cards,
// before it is drawn as HTML):
//   window.mosaic.providerData["mosaic-provider-jobcards"] = {...}   the search results (each card: jobkey, title, company,
//                                                                    formattedLocation, salarySnippet, pubDate ...)
//   window._initialData = {...}                                      the open job's header and full description
// The variables are cut out with a bracket matcher that skips text inside strings (a greedy pattern would stop at the
// first "};" it meets). The visible cards (data-jk links and data-testid fields) are the fallback when the variables are
// missing. Read-only: nothing here sends, clicks or fetches anything.
(function (root) {
  "use strict";

  const SITE = "indeed";
  const ORIGIN = "https://www.indeed.com";
  const CARDS_VARIABLE = /window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*/;
  const INITIAL_DATA = /window\._initialData\s*=\s*/;
  const REMOTE_WORDS = /\bremote\b|work from home|telecommut/i;
  const HYBRID_WORDS = /\bhybrid\b/i;

  function onJobsPage(loc) {
    // The same pages "Save this page for fixing" works on: the home page, search and job pages, a company's page.
    return /^\/(?:$|jobs|viewjob|m\/viewjob|rc\/|q-|l-|cmp\/)/i.test(loc.pathname);
  }

  function paramOf(pageUrl, name) {
    try {
      return new URL(pageUrl).searchParams.get(name) || "";
    } catch {
      return "";
    }
  }

  function jobUrl(key) {
    return key ? `${ORIGIN}/viewjob?jk=${key}` : "";
  }

  function idFromUrl(pageUrl) {
    return paramOf(pageUrl, "jk") || paramOf(pageUrl, "vjk") || "";
  }

  function pageKind(pageUrl) {
    try {
      return /\/viewjob/i.test(new URL(pageUrl).pathname) ? "other" : "search";
    } catch {
      return "other";
    }
  }

  function expectsJobs(pageUrl) {
    try {
      const url = new URL(pageUrl);
      return /^\/(?:m\/)?viewjob/i.test(url.pathname) || (/^\/jobs/i.test(url.pathname) && url.searchParams.has("q"));
    } catch {
      return false;
    }
  }

  // The job open in the details pane, or on its own page.
  function detailId(pageUrl, jobs) {
    const wanted = idFromUrl(pageUrl);
    return wanted && jobs.some((job) => job.job_id === wanted) ? wanted : null;
  }

  // ---------- hidden web data: finding a variable and cutting its value out of the script ----------

  // The text of the object or array that starts at `start` (a "{" or "["), matched by brackets, skipping strings.
  function balanced(text, start) {
    const open = text[start];
    const close = open === "{" ? "}" : open === "[" ? "]" : "";
    if (!close) return "";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === open) {
        depth += 1;
      } else if (char === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return "";
  }

  // The parsed value of `window.x = {...}` for the given "window.x =" pattern, or null.
  function variable(text, pattern) {
    const match = pattern.exec(text);
    if (!match) return null;
    const start = match.index + match[0].length;
    const raw = balanced(text, start);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ---------- turning Indeed's records into the standard job record ----------

  function plain(html, doc) {
    const view = (doc && doc.defaultView) || root;
    if (!view.DOMParser) return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const parsed = new view.DOMParser().parseFromString(String(html || ""), "text/html");
    return (parsed.body.textContent || "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  }

  function dateOf(milliseconds) {
    const when = new Date(Number(milliseconds));
    return Number.isFinite(when.getTime()) ? when.toISOString().slice(0, 10) : "";
  }

  // The pay as the card shows it ("$35,000 - $45,000 a year", "$50 - $100 an hour"). extractedSalary is an estimate Indeed
  // makes for some cards (a per-mile driver becomes a yearly range), so it is never used when there is no pay text.
  function salaryText(record) {
    const snippet = record && record.salarySnippet;
    return snippet && typeof snippet.text === "string" ? snippet.text.trim() : "";
  }

  function arrangement(record, location) {
    const text = `${record.title || ""} ${location}`;
    if (record.remoteLocation === true || REMOTE_WORDS.test(text)) return "Remote";
    if (HYBRID_WORDS.test(text)) return "Hybrid";
    return "";
  }

  function job(fields, pageUrl) {
    const record = {
      site: SITE, job_id: "", title: "", company: "", location: "", salary: "", work_arrangement: "", posted: "",
      description: "", closed: false, applied: false, url: pageUrl, ...fields,
    };
    record.title = String(record.title || "").trim();
    record.url = jobUrl(record.job_id) || record.url;
    record.level = record.description.length > 150 ? "opened" : "seen";
    record.page_kind = pageKind(pageUrl);
    return record;
  }

  function fromCard(card, pageUrl) {
    const key = String(card.jobkey || "");
    if (!key) return null;
    const location = String(card.formattedLocation || [card.jobLocationCity, card.jobLocationState].filter(Boolean).join(", "));
    return job({
      job_id: key, title: card.displayTitle || card.title, company: card.company || card.truncatedCompany || "", location,
      salary: salaryText(card), work_arrangement: arrangement(card, location), posted: dateOf(card.pubDate),
      closed: card.expired === true,
    }, pageUrl);
  }

  // The open job's header and description, wherever the page keeps them (`autoOpenTwoPaneViewjobResponse.body` on a search
  // page, the top of the data on a job's own page).
  function* jobInfoModels(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (value.jobInfoModel && typeof value.jobInfoModel === "object") yield value.jobInfoModel;
    for (const child of Object.values(value)) yield* jobInfoModels(child, depth + 1);
  }

  function fromInfo(info, key, doc, pageUrl) {
    const header = info.jobInfoHeaderModel || {};
    const title = header.jobTitle || "";
    if (!key || !title) return null;
    const location = String(header.formattedLocation || "");
    return job({
      job_id: key, title, company: header.companyName || "", location,
      work_arrangement: arrangement({ title }, location), description: plain(info.sanitizedJobDescription, doc),
    }, pageUrl);
  }

  // Jobs from the page's script variables. `done` remembers scripts already read, so a page that keeps adding scripts
  // is not read twice.
  function fromEmbedded(doc, pageUrl, done) {
    const jobs = [];
    for (const script of doc.querySelectorAll("script")) {
      if (done && done.has(script)) continue;
      const text = script.textContent || "";
      if (!text.includes("mosaic-provider-jobcards") && !text.includes("_initialData")) continue;
      const cards = variable(text, CARDS_VARIABLE);
      const results = cards && cards.metaData && cards.metaData.mosaicProviderJobCardsModel
        && cards.metaData.mosaicProviderJobCardsModel.results;
      for (const card of Array.isArray(results) ? results : []) {
        const found = fromCard(card, pageUrl);
        if (found) jobs.push(found);
      }
      const data = variable(text, INITIAL_DATA);
      if (data) {
        const openKey = String(data.autoOpenTwoPaneJobKey || idFromUrl(pageUrl) || "");
        const info = jobInfoModels(data).next().value; // the one open job (the first record found)
        const found = info ? fromInfo(info, openKey, doc, pageUrl) : null;
        if (found) jobs.push(found);
      }
      if (done && (cards || data)) done.add(script);
    }
    return jobs;
  }

  // The visible cards: a link with data-jk, and the company, place and pay near it.
  function fromDom(doc, pageUrl) {
    const jobs = [];
    const seen = new Set();
    for (const link of doc.querySelectorAll("a[data-jk]")) {
      const key = link.getAttribute("data-jk");
      if (!key || seen.has(key)) continue;
      const card = link.closest("[data-testid='slider_item'], .job_seen_beacon, li, td.resultContent") || link.parentElement;
      const text = (selector) => {
        const node = card && card.querySelector(selector);
        return node ? node.textContent.replace(/\s+/g, " ").trim() : "";
      };
      const title = (link.getAttribute("aria-label") || "").replace(/^full details of\s+/i, "").trim()
        || link.textContent.replace(/\s+/g, " ").trim();
      const company = text("[data-testid='company-name']");
      if (!company) continue; // a title link outside a card (a header, an ad slot) has no employer: not a job to save
      const location = text("[data-testid='text-location']");
      const salary = text(".salary-snippet-container, [data-testid='attribute_snippet_testid salary-snippet-container']");
      seen.add(key);
      jobs.push(job({
        job_id: key, title, company, location, salary,
        work_arrangement: arrangement({ title }, location),
      }, pageUrl));
    }
    return jobs;
  }

  root.IndeedParse = {
    SITE, NAME: "Indeed", fromEmbedded, fromDom, expectsJobs, onJobsPage, pageKind, detailId, jobUrl, idFromUrl,
    // for the tests
    balanced, variable,
  };
  root.CaptureParse = root.IndeedParse;
})(typeof globalThis !== "undefined" ? globalThis : this);

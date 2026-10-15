// Reads the State of Maryland's job openings from its public RSS feed (https://www.jobapscloud.com/MD/rss.asp), the
// feed the site itself offers for this. One request returns every open job, so nothing is browsed or clicked.
// Used by background.js (which fetches it) and tests/jobaps-feed.test.js.
(function (root) {
  "use strict";

  const SITE = "jobaps";
  const FEED_URL = "https://www.jobapscloud.com/MD/rss.asp";

  // The text of an HTML snippet, one paragraph or list item per line. DOMParser builds an inert document: no scripts
  // run and no images load.
  function plain(html, ParserClass) {
    const Parser = ParserClass || root.DOMParser;
    const spaced = String(html || "").replace(/<\/(?:p|li|ul)>|<br\s*\/?>/gi, "$&\n");
    const doc = new Parser().parseFromString(spaced, "text/html");
    return (doc.body.textContent || "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  }

  // The "<p><strong>Label:</strong> value</p>" parts of a description, as {label: value}. A list after a label
  // ("<ul><li>Baltimore City</li></ul>") sits outside its paragraph in HTML, so values are cut from the text instead.
  function fields(html, ParserClass) {
    const result = {};
    for (const part of String(html || "").split(/<p>\s*<strong>/i).slice(1)) {
      const end = part.indexOf("</strong>");
      if (end < 0) continue;
      const label = plain(part.slice(0, end), ParserClass).replace(/:\s*$/, "");
      const rest = part.slice(end + 9).split(/<\/p>/i)[0];
      const value = plain(rest, ParserClass).replace(/^[\s:]+|[\s.]+$/g, "").replace(/\s*\n\s*/g, ", ");
      if (label && !(label in result)) result[label] = value;
    }
    return result;
  }

  // "10/14/2026 4:00:00 PM" -> "2026-10-14"
  function isoDay(text) {
    const match = String(text || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return match ? `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : "";
  }

  function place(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return /,\s*[A-Z]{2}$|statewide/i.test(value) ? value : `${value}, MD`;
  }

  // The jobs in the feed's XML text. `ParserClass` is DOMParser (the page's own, or jsdom's in tests).
  function parse(xmlText, ParserClass) {
    const Parser = ParserClass || root.DOMParser;
    const xml = new Parser().parseFromString(String(xmlText || ""), "text/xml");
    const jobs = [];
    for (const item of Array.from(xml.getElementsByTagName("item"))) {
      const tag = (name) => ((item.getElementsByTagName(name)[0] || {}).textContent || "").trim();
      const link = tag("link");
      const ids = link.match(/R1=(\d+)&R2=(\d+)&R3=(\d+)/i);
      const title = tag("title").replace(/\s+/g, " ").replace(/\s*-\s*#[\d-]+\s*$/, "").trim();
      if (!ids || !title) continue;
      const html = tag("description");
      const info = fields(html, Parser);
      const department = info.Department || "";
      jobs.push({
        site: SITE,
        job_id: `${ids[1]}-${ids[2]}-${ids[3]}`,
        title,
        company: department ? `State of Maryland: ${department}` : "State of Maryland",
        location: place(info["Work Location"]),
        salary: (info.Salary || "").replace(/\.$/, ""),
        work_arrangement: /\btelework|\bremote\b/i.test(title) ? "Remote" : "",
        posted: isoDay(info["Date Opened"]) || isoDay(tag("pubDate")),
        deadline: isoDay(info["Filing Deadline"]),
        employment_type: info["Employment Type"] || "",
        description: plain(html, Parser),
        closed: false,
        applied: false,
        url: link,
        level: "opened",
        page_kind: "feed",
      });
    }
    return jobs;
  }

  root.JobapsFeed = { SITE, FEED_URL, parse };
})(typeof globalThis !== "undefined" ? globalThis : this);

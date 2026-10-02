// Which LinkedIn jobs may fit you, using your Job Finder profile (titles, skills, work preferences).
// Pure functions, no page access: used by content/fit-marks.js and the tests.
(function (root) {
  "use strict";

  // Words that say little about the role, so "Senior Web Designer II" still matches "Web Designer".
  const FILLER = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "at", "with", "i", "ii", "iii", "iv",
    "sr", "jr", "senior", "junior", "lead", "level", "entry", "associate", "remote", "hybrid", "contract",
    "temporary", "temp", "part", "time", "full"]);

  // Job words that fit almost any field, so matching only them says nothing.
  const GENERIC_ROLES = new Set(["specialist", "coordinator", "manager", "associate", "assistant", "analyst", "administrator",
    "editor", "director", "officer", "representative", "consultant", "generalist", "executive", "intern", "engineer"]);

  function words(text) {
    return String(text || "").toLowerCase()
      .replace(/front[\s-]?end/g, "frontend").replace(/\bwebsite\b/g, "web").replace(/\bux\s*\/\s*ui\b|\bui\s*\/\s*ux\b/g, "ux ui")
      .split(/[^a-z0-9+#]+/).filter((word) => word && !FILLER.has(word));
  }

  // "designer" and "designers", "developer"/"development" are close enough for a title.
  function sameWord(a, b) {
    if (a === b) return true;
    const stem = (w) => w.replace(/(?:ers|er|ing|ment|s)$/, "");
    return a.length > 3 && b.length > 3 && stem(a) === stem(b);
  }

  // How well a job title matches your titles: "good" when every word of one of your titles is in it,
  // "maybe" when at least half of a title's words are (and it has two or more). Returns { level, title }.
  function titleFit(jobTitle, myTitles) {
    const job = words(jobTitle);
    let best = { level: "", title: "" };
    for (const title of myTitles || []) {
      const mine = words(title);
      if (!mine.length) continue;
      const found = mine.filter((word) => job.some((other) => sameWord(word, other))).length;
      if (found === mine.length) return { level: "good", title };
      // "Maybe" (titles of two or more words): the job word (the last one) plus at least half the words, so
      // "Web Content Specialist" is not a "content designer" for sharing only "content". When the job word is a common
      // one ("specialist", "manager" ...) it proves nothing, so every descriptive word must match instead:
      // "Digital Production Manager" is a maybe for "production specialist", "Marketing Specialist" is not.
      const role = mine[mine.length - 1];
      const qualifiers = mine.slice(0, -1);
      const qualifierHits = qualifiers.filter((word) => job.some((other) => sameWord(word, other))).length;
      const maybe = mine.length >= 2 && (GENERIC_ROLES.has(role)
        ? qualifierHits === qualifiers.length
        : found * 2 >= mine.length && job.some((other) => sameWord(role, other)));
      if (maybe && !best.level) best = { level: "maybe", title };
    }
    return best;
  }

  // False only when you chose work locations (Remote/Hybrid/Onsite) and the job clearly has a different one.
  function arrangementFits(arrangement, preferences) {
    const wanted = (preferences || []).map((p) => p.toLowerCase().replace("on-site", "onsite"))
      .filter((p) => ["remote", "hybrid", "onsite"].includes(p));
    const job = String(arrangement || "").toLowerCase().replace("on-site", "onsite");
    return !wanted.length || !job || wanted.includes(job);
  }

  function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Skills a description mentions, by Job Finder's skill names and spellings. Skills that are also everyday words
  // ("React", "Bootstrap") count only when written with a capital letter, like Job Finder's stricter check.
  function detectSkills(text, aliases, ambiguous) {
    const body = String(text || "").slice(0, 250000);
    const careful = new Set(ambiguous || []);
    const found = [];
    for (const [skill, spellings] of Object.entries(aliases || {})) {
      for (const spelling of spellings) {
        const caseMatters = careful.has(skill) && spelling === skill.toLowerCase();
        const pattern = new RegExp(`(?<![\\w])${escape(caseMatters ? skill : spelling)}(?![\\w])`, caseMatters ? "" : "i");
        if (pattern.test(body)) {
          found.push(skill);
          break;
        }
      }
    }
    return found;
  }

  // Job Fit as on the Dashboard: the share of the skills the listing names that you have.
  function jobFit(mySkills, jobSkills) {
    const mine = new Set((mySkills || []).map((s) => s.toLowerCase()));
    const matched = jobSkills.filter((s) => mine.has(s.toLowerCase()));
    const missing = jobSkills.filter((s) => !mine.has(s.toLowerCase()));
    return { score: jobSkills.length ? Math.round((100 * matched.length) / jobSkills.length) : null, matched, missing };
  }

  // A job card worth a look: its title fits and its work location isn't one you ruled out.
  function cardFit(job, profile) {
    if (!profile || !(profile.titles || []).length) return null;
    const title = titleFit(job.title, profile.titles);
    if (!title.level || !arrangementFits(job.work_arrangement, profile.work_preferences)) return null;
    const how = title.level === "good" ? "Title matches" : "Title is close to";
    return { level: title.level, reason: `${how} "${title.title}"${job.work_arrangement ? ` · ${job.work_arrangement}` : ""}` };
  }

  root.LinkedInFit = { words, titleFit, arrangementFits, detectSkills, jobFit, cardFit };
})(typeof globalThis !== "undefined" ? globalThis : this);

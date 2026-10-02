// LinkedIn only. Using your Job Finder profile (fetched by background.js into storage as "fitProfile"):
//   - highlights job cards whose title fits one of your titles (one colour, with a "Fit" tag),
//   - shows the open job's whole description instead of LinkedIn's shortened one with "… more",
//   - adds a Job Fit badge above "About the job": the share of the skills it names that you have,
//   - tags every card with its estimated distance and 6 a.m. drive time from your Home ZIP (worked out by Job Finder),
//     and lists the cards nearest first. Ordering only sets display styles (CSS "order"); no card is ever moved,
//     so LinkedIn's own page is left intact.
// Display only: it never clicks, scrolls, navigates or fetches. The full description is already in the page;
// LinkedIn only hides part of it with styling, so this undoes that styling instead of pressing "more".
// Badges live in a shadow root, so the capture code (which reads the page's text) never sees them.
(function () {
  "use strict";

  const parse = globalThis.LinkedInParse;
  const fit = globalThis.LinkedInFit;
  if (!parse || !fit) return;
  const MARK = "data-wjs-fit";
  const MORE_BUTTON = /^(?:…|\.\.\.)?\s*(?:see|show)?\s*more$/i;
  let profile = null;
  let timer = null;
  let sortOn = true; // the panel's "nearest first" checkbox
  let running = false;
  const distances = new Map(); // job town text -> { miles, minutes, text } or null
  const reordered = new Set(); // elements given a CSS order

  const style = document.createElement("style");
  style.textContent = `
    [${MARK}] { position: relative !important; box-shadow: inset 4px 0 0 #0b7a55 !important;
      background-color: rgba(16, 185, 129, 0.09) !important; }
    wjs-fit-tag { position: absolute; top: 6px; right: 8px; z-index: 2; pointer-events: none; }
    wjs-fit-tag[data-distance] { top: auto; bottom: 6px; }`;
  (document.head || document.documentElement).appendChild(style);

  function tag(text, extraCss) {
    const host = document.createElement("wjs-fit-tag");
    const shadow = host.attachShadow({ mode: "open" });
    const label = document.createElement("span");
    label.textContent = text;
    label.style.cssText = "font: 700 11px/1.6 system-ui, sans-serif; color: #fff; background: #0b7a55; " +
      "border-radius: 999px; padding: 1px 8px; letter-spacing: .02em;" + (extraCss || "");
    shadow.appendChild(label);
    return host;
  }

  async function loadDistances(cards) {
    const places = [...new Set(cards.map(({ job }) => job.location).filter((place) => place && !distances.has(place)))];
    if (!places.length) return;
    try {
      const reply = await browser.runtime.sendMessage({ type: "distances", places });
      for (const place of places) if (reply && reply.places && place in reply.places) distances.set(place, reply.places[place]);
    } catch (error) { /* Job Finder isn't running: no distances this time */ }
  }

  function markDistances(cards) {
    for (const { element, job } of cards) {
      const found = distances.get(job.location);
      const old = element.querySelector(":scope > wjs-fit-tag[data-distance]");
      if (!found) { old?.remove(); continue; }
      if (old && old.dataset.label === found.text) continue;
      old?.remove();
      const host = tag(found.text, "background: #374151;");
      host.dataset.distance = "1";
      host.dataset.label = found.text;
      host.title = "Estimated from your Home ZIP, driving at 6 a.m.";
      if (getComputedStyle(element).position === "static") element.style.setProperty("position", "relative", "important");
      element.appendChild(host);
    }
  }

  // Lists the cards nearest first with CSS "order" on each card's slot in the list. Cards with no known distance
  // go last; everything else in the list keeps its place.
  function sortNearestFirst(cards) {
    for (const element of reordered) element.style.removeProperty("order");
    reordered.clear();
    if (!sortOn || cards.length < 2) return;
    let list = cards[0].element.parentElement;
    while (list && !cards.every(({ element }) => list.contains(element))) list = list.parentElement;
    if (!list) return;
    const slotOf = (element) => { let node = element; while (node.parentElement !== list) node = node.parentElement; return node; };
    const slots = cards.map(({ element }) => slotOf(element));
    if (new Set(slots).size !== slots.length) return; // cards share a slot: leave the page alone
    const place = new Map(Array.from(list.children, (child, index) => [child, index]));
    const free = slots.map((slot) => place.get(slot)).sort((a, b) => a - b);
    const minutes = (card) => { const found = distances.get(card.job.location); return found ? found.minutes : 1e9; };
    const ranked = cards.map((card, i) => ({ slot: slots[i], at: place.get(slots[i]), minutes: minutes(card) }))
      .sort((a, b) => a.minutes - b.minutes || a.at - b.at);
    if (!ranked.some((item) => item.minutes < 1e9)) return; // no distances known: nothing to sort by
    list.style.setProperty("display", "flex", "important");
    list.style.setProperty("flex-direction", "column", "important");
    for (const child of list.children) { child.style.setProperty("order", String(place.get(child))); reordered.add(child); }
    ranked.forEach((item, i) => item.slot.style.setProperty("order", String(free[i])));
  }

  function markCards() {
    for (const { element, job } of parse.cards(document, location.href)) {
      const result = profile ? fit.cardFit(job, profile) : null;
      const current = element.getAttribute(MARK);
      if (!result) {
        if (current !== null) {
          element.removeAttribute(MARK);
          element.querySelector(":scope > wjs-fit-tag")?.remove();
        }
        continue;
      }
      if (current === result.reason) continue;
      element.setAttribute(MARK, result.reason);
      element.setAttribute("title", result.reason);
      if (!element.querySelector(":scope > wjs-fit-tag")) element.appendChild(tag("Fit"));
    }
  }

  // The nearest box around "About the job" that holds the description, as the capture code finds it.
  function descriptionBox(heading) {
    let box = heading.parentElement;
    while (box && (box.textContent || "").trim().length < 200) box = box.parentElement;
    return box;
  }

  function showWholeDescription(box) {
    const elements = [box, ...Array.from(box.querySelectorAll("*")).slice(0, 400)];
    for (const el of elements) {
      if (el.tagName === "BUTTON" && MORE_BUTTON.test((el.textContent || "").trim())) {
        el.style.setProperty("display", "none", "important");
        continue;
      }
      const css = getComputedStyle(el);
      const clamped = css.webkitLineClamp && css.webkitLineClamp !== "none";
      const capped = css.maxHeight && css.maxHeight !== "none";
      const cut = css.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 2;
      if (clamped || capped || cut) {
        el.style.setProperty("-webkit-line-clamp", "unset", "important");
        el.style.setProperty("max-height", "none", "important");
        if (cut || clamped) el.style.setProperty("overflow", "visible", "important");
        if (clamped) el.style.setProperty("display", "block", "important");
      }
    }
  }

  function fitBadge(heading, box) {
    const old = heading.parentElement.querySelector(":scope > wjs-fit-tag[data-detail]");
    if (!profile || !(profile.skills || []).length) {
      old?.remove();
      return;
    }
    const text = (box.innerText || box.textContent || "").slice(0, 250000);
    const result = fit.jobFit(profile.skills, fit.detectSkills(text, profile.skill_aliases, profile.ambiguous_skills));
    const label = result.score === null ? "Job Fit: the listing names too few skills to tell"
      : `Job Fit ${result.score}%` + (result.matched.length ? ` · You have: ${result.matched.join(", ")}` : "")
        + (result.missing.length ? ` · Also asks for: ${result.missing.join(", ")}` : "");
    if (old && old.dataset.label === label) return;
    old?.remove();
    const host = tag(label, "display: inline-block; font-size: 12px; padding: 3px 10px; white-space: normal;");
    host.dataset.detail = "1";
    host.dataset.label = label;
    host.style.cssText = "position: static; display: block; margin: 0 0 8px;";
    heading.parentElement.insertBefore(host, heading);
  }

  async function run() {
    timer = null;
    if (!parse.onJobsPage(location) || running) return;
    running = true;
    try {
      const cards = parse.cards(document, location.href);
      await loadDistances(cards);
      markDistances(cards);
      sortNearestFirst(cards);
    } finally {
      running = false;
    }
    markCards();
    const heading = parse.aboutHeading(document);
    if (!heading) return;
    const box = descriptionBox(heading);
    if (!box) return;
    showWholeDescription(box);
    fitBadge(heading, box);
  }

  function schedule() {
    if (!timer) timer = setTimeout(run, 600);
  }

  browser.storage.local.get(["fitProfile", "sortByDistance"]).then((saved) => {
    profile = saved.fitProfile || null;
    sortOn = saved.sortByDistance !== false;
    schedule();
  }).catch(() => {});
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.fitProfile) profile = changes.fitProfile.newValue || null;
    if (changes.sortByDistance) sortOn = changes.sortByDistance.newValue !== false;
    schedule();
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();

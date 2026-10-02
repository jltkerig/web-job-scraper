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
  let hiddenCompanies = []; // companies you hid with the card's X button (shown in the panel, where you can bring them back)
  const company = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  const style = document.createElement("style");
  style.textContent = `
    [${MARK}] { position: relative !important; }
    wjs-fit-tag { position: absolute; top: 6px; right: 8px; z-index: 2; pointer-events: none; }
    wjs-fit-tag[data-distance] { top: auto; bottom: 6px; }
    wjs-fit-tag[data-hide] { top: 30px; pointer-events: auto; }
    /* LinkedIn's own grey dismiss X on a card: only the red one stays */
    [data-wjs-card] button[aria-label^="Dismiss "][aria-label$=" job"] { display: none !important; }`;
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

  // A small X on each card: hides every job from that company. It lives in a shadow root and swallows its own clicks,
  // so LinkedIn never sees them (the card doesn't open).
  function hideButton(name) {
    const host = document.createElement("wjs-fit-tag");
    host.dataset.hide = "1";
    host.dataset.company = name;
    const shadow = host.attachShadow({ mode: "open" });
    const button = document.createElement("button");
    button.type = "button";
    // The X is drawn as two lines in an SVG (not a text character), so it sits exactly in the middle of the circle.
    button.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" style="display:block">' +
      '<path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
    button.title = `Hide jobs from ${name}`;
    button.setAttribute("aria-label", `Hide jobs from ${name}`);
    const look = (filled) => {
      button.style.cssText = "display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; " +
        "border-radius: 50%; border: 2px solid #dc2626; cursor: pointer; padding: 0; margin: 0; box-sizing: border-box; " +
        "box-shadow: 0 1px 3px rgba(0,0,0,.25); " +
        (filled ? "background: #dc2626; color: #fff;" : "background: #fff; color: #dc2626;");
    };
    look(false);
    button.addEventListener("mouseenter", () => look(true));
    button.addEventListener("mouseleave", () => look(false));
    button.addEventListener("focus", () => look(true));
    button.addEventListener("blur", () => look(false));
    for (const type of ["pointerdown", "mousedown", "mouseup", "keydown"]) {
      button.addEventListener(type, (event) => event.stopPropagation());
    }
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!hiddenCompanies.some((saved) => company(saved) === company(name))) hiddenCompanies = [...hiddenCompanies, name];
      try { await browser.storage.local.set({ hiddenCompanies }); } catch (error) { /* hidden until the page reloads */ }
      schedule();
    });
    shadow.appendChild(button);
    return host;
  }

  function isHidden(job) {
    const key = company(job.company);
    if (!key) return false;
    return hiddenCompanies.some((saved) => company(saved) === key)
      || ((profile && profile.blocked_companies) || []).some((saved) => company(saved) === key);
  }

  // Each card's slot in the list (the list's own child that holds it), so a whole slot can be hidden or ordered.
  function slotsFor(cards) {
    const slots = new Map(cards.map(({ element }) => [element, element]));
    if (cards.length < 2) return slots;
    let list = cards[0].element.parentElement;
    while (list && !cards.every(({ element }) => list.contains(element))) list = list.parentElement;
    if (!list) return slots;
    const found = cards.map(({ element }) => { let node = element; while (node.parentElement !== list) node = node.parentElement; return node; });
    if (new Set(found).size === found.length) cards.forEach(({ element }, i) => slots.set(element, found[i]));
    return slots;
  }

  const retryAt = new Map(); // place -> time before which it isn't asked about again after a failure
  // A remote job has no commute: tagged "Remote" and listed first. Otherwise Job Finder's estimate for the town.
  const REMOTE = { minutes: 0, text: "Remote · no commute" };
  function distanceOf(job) {
    if (job.work_arrangement === "Remote" || /^united states \(remote\)$/i.test(job.location)) return REMOTE;
    return distances.get(job.location);
  }

  async function loadDistances(cards) {
    const now = Date.now();
    const places = [...new Set(cards.filter(({ job }) => distanceOf(job) !== REMOTE).map(({ job }) => job.location)
      .filter((place) => place && !distances.has(place) && (retryAt.get(place) || 0) <= now))];
    if (!places.length) return;
    let reply = null;
    try {
      reply = await browser.runtime.sendMessage({ type: "distances", places });
    } catch (error) { /* the background script didn't answer */ }
    for (const place of places) {
      if (reply && reply.places && place in reply.places) distances.set(place, reply.places[place]);
      else retryAt.set(place, now + 2 * 60 * 1000); // failed: wait two minutes, not a second
    }
  }

  function markDistances(cards) {
    for (const { element, job } of cards) {
      const found = distanceOf(job);
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
    const minutes = (card) => { const found = distanceOf(card.job); return found ? found.minutes : 1e9; };
    const ranked = cards.map((card, i) => ({ slot: slots[i], at: place.get(slots[i]), minutes: minutes(card) }))
      .sort((a, b) => a.minutes - b.minutes || a.at - b.at);
    if (!ranked.some((item) => item.minutes < 1e9)) return; // no distances known: nothing to sort by
    list.style.setProperty("display", "flex", "important");
    list.style.setProperty("flex-direction", "column", "important");
    for (const child of list.children) { child.style.setProperty("order", String(place.get(child))); reordered.add(child); }
    ranked.forEach((item, i) => item.slot.style.setProperty("order", String(free[i])));
  }

  function markCards(cards) {
    for (const { element, job } of cards) {
      const result = profile ? fit.cardFit(job, profile) : null;
      const current = element.getAttribute(MARK);
      if (!result) {
        if (current !== null) {
          element.removeAttribute(MARK);
          element.querySelector(":scope > wjs-fit-tag[data-fit]")?.remove();
          element.querySelector(":scope > wjs-fit-tag[data-bar]")?.remove();
        }
        continue;
      }
      if (current === result.reason) continue;
      element.setAttribute(MARK, result.reason);
      element.setAttribute("title", result.reason);
      if (!element.querySelector(":scope > wjs-fit-tag[data-fit]")) {
        const host = tag("Fit");
        host.dataset.fit = "1";
        element.appendChild(host);
      }
      // The green bar and a light green wash are an overlay of their own on top of the card's contents (like the tags),
      // so nothing inside LinkedIn's card can paint over them. It ignores the mouse, so the card still clicks normally.
      if (!element.querySelector(":scope > wjs-fit-tag[data-bar]")) {
        const bar = document.createElement("wjs-fit-tag");
        bar.dataset.bar = "1";
        bar.style.cssText = "top: 0; right: 0; bottom: 0; left: 0; z-index: 1; pointer-events: none;";
        const shadow = bar.attachShadow({ mode: "open" });
        shadow.innerHTML = '<div style="position:absolute;inset:0;background:rgba(16,185,129,.10)"></div>' +
          '<div style="position:absolute;left:0;top:0;bottom:0;width:6px;background:#0b7a55"></div>';
        element.appendChild(bar);
      }
    }
  }

  // Adds the X button to each shown card, and hides (or brings back) whole cards by company.
  function applyHiding(all, slots) {
    const shown = [];
    for (const card of all) {
      const slot = slots.get(card.element);
      if (isHidden(card.job)) {
        slot.style.setProperty("display", "none", "important");
        slot.setAttribute("data-wjs-hidden", "1");
        continue;
      }
      if (slot.hasAttribute("data-wjs-hidden")) {
        slot.style.removeProperty("display");
        slot.removeAttribute("data-wjs-hidden");
      }
      shown.push(card);
      card.element.setAttribute("data-wjs-card", "1");
      const name = card.job.company;
      const old = card.element.querySelector(":scope > wjs-fit-tag[data-hide]");
      if (name && (!old || old.dataset.company !== name)) {
        old?.remove();
        if (getComputedStyle(card.element).position === "static") card.element.style.setProperty("position", "relative", "important");
        card.element.appendChild(hideButton(name));
      }
    }
    return shown;
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
      const all = parse.cards(document, location.href);
      const cards = applyHiding(all, slotsFor(all));
      await loadDistances(cards);
      markDistances(cards);
      sortNearestFirst(cards);
      markCards(cards);
    } finally {
      running = false;
    }
    checkProfile();
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

  // No profile (or one with no titles) means no Fit tags or green bars. Ask the background script to read it from
  // Job Finder now, and say so on the page, so a missing profile is never a silent "nothing is green".
  let notice = null;
  let askedAt = 0;
  let problem = "Fit markers: waiting for your Job Finder profile…"; // what the last attempt found
  function showNotice(text) {
    if (!text) { notice?.remove(); notice = null; return; }
    if (!notice) {
      notice = document.createElement("wjs-fit-tag");
      notice.style.cssText = "position: fixed; left: 12px; bottom: 12px; top: auto; right: auto; z-index: 2147483001; pointer-events: auto;";
      const shadow = notice.attachShadow({ mode: "open" });
      const box = document.createElement("div");
      box.style.cssText = "font: 600 12px/1.4 system-ui, sans-serif; color: #fff; background: #374151; border-radius: 8px; " +
        "padding: 8px 12px; max-width: 320px; box-shadow: 0 2px 8px rgba(0,0,0,.3);";
      shadow.appendChild(box);
      document.documentElement.appendChild(notice);
    }
    notice.shadowRoot.firstChild.textContent = text;
    liftAboveFox();
  }
  // The fox's garden is a strip along the whole bottom of the page (a small round badge when it is minimized, at the
  // right). While the strip is showing, the notice sits above it instead of behind it.
  function liftAboveFox() {
    if (!notice) return;
    const fox = document.querySelector("[data-wjs-fox-host]");
    const box = fox && fox.getBoundingClientRect();
    const strip = box && box.width > 120 && box.height > 0;
    notice.style.setProperty("bottom", `${strip ? Math.round(box.height) + 12 : 12}px`, "important");
  }
  async function checkProfile() {
    liftAboveFox();
    if (profile && (profile.titles || []).length) { showNotice(""); return; }
    if (!parse.onJobsPage(location)) return;
    showNotice(problem);
    if (Date.now() - askedAt < 30 * 1000) return;
    askedAt = Date.now();
    try {
      const reply = await browser.runtime.sendMessage({ type: "fit-profile-now" });
      if (reply && reply.titles) {
        const saved = await browser.storage.local.get("fitProfile");
        profile = saved.fitProfile || profile;
        showNotice("");
        schedule();
      } else {
        problem = reply && reply.error ? `Fit markers: ${reply.error}`
          : "Fit markers: your Job Finder profile has no job titles yet, so nothing is marked.";
        showNotice(problem);
      }
    } catch (error) {
      problem = "Fit markers: the extension couldn't reach Job Finder. Is it running?";
      showNotice(problem);
    }
  }

  browser.storage.local.get(["fitProfile", "sortByDistance", "hiddenCompanies"]).then((saved) => {
    profile = saved.fitProfile || null;
    sortOn = saved.sortByDistance !== false;
    hiddenCompanies = saved.hiddenCompanies || [];
    schedule();
  }).catch(() => {});
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.fitProfile) profile = changes.fitProfile.newValue || null;
    if (changes.hiddenCompanies) hiddenCompanies = changes.hiddenCompanies.newValue || [];
    if (changes.sortByDistance) sortOn = changes.sortByDistance.newValue !== false;
    schedule();
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(liftAboveFox, 1500); // the fox can be opened or minimized at any time
})();

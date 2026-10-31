"use strict";

const sitesBox = document.getElementById("sites");
const needsList = document.getElementById("needs-list");
const needsCount = document.getElementById("needs-count");
const message = document.getElementById("message");

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function timeAgo(iso) {
  if (!iso) return "not saved yet";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "saved just now";
  if (minutes < 60) return `saved ${minutes} min ago`;
  return `saved at ${new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function send(payload) {
  return browser.runtime.sendMessage(payload);
}

function savePage(site) {
  message.textContent = "Saving page…";
  send({ type: "save-debug", site })
    .then((reply) => { message.textContent = `Saved in your downloads folder: ${reply.folder.replaceAll("/", "\\")}`; })
    .catch((error) => { message.textContent = String(error.message || error); });
}

// Where each website's title goes when clicked: the page for finding jobs there.
const SITE_PAGES = {
  linkedin: "https://www.linkedin.com/jobs/",
  mwe: "https://mwejobs.maryland.gov/",
  usajobs: "https://www.usajobs.gov/",
  jobaps: "https://www.jobapscloud.com/md/jobs/mdod/",
  indeed: "https://www.indeed.com/",
};

function siteTitle(site, name) {
  const url = SITE_PAGES[site];
  if (!url) return el("span", { textContent: name });
  const link = el("a", { href: url, textContent: name, className: "site-link", title: `Open ${name} in a new tab` });
  link.addEventListener("click", (event) => {
    event.preventDefault();
    browser.tabs.create({ url });
  });
  return link;
}

// The site whose page is open in this window's tab, so its card can come first. Stays "" on any other page.
let currentSite = "";
function siteOfTab(tabUrl) {
  let host = "";
  try {
    host = new URL(tabUrl).hostname.replace(/^www./, "");
  } catch {
    return "";
  }
  return Object.keys(SITE_PAGES).find((site) => new URL(SITE_PAGES[site]).hostname.replace(/^www./, "") === host) || "";
}

function show(result) {
  sitesBox.replaceChildren();
  const ordered = Object.entries(result.sites).sort(([a], [b]) => (b === currentSite) - (a === currentSite));
  for (const [site, info] of ordered) {
    const toggle = el("input", { type: "checkbox", checked: info.enabled, title: "Capture on this site" });
    toggle.addEventListener("change", () => send({ type: "set-enabled", site, enabled: toggle.checked }).then(show));
    const card = el("div", { className: "site" }, [
      el("div", { className: "site-head" }, [siteTitle(site, info.name), el("label", {}, [toggle, " On"])]),
      el("div", {
        className: "counts",
        textContent: `Today: ${info.seen} seen · ${info.opened} opened · ${info.fresh} new`,
      }),
      el("div", { className: "saved", textContent: timeAgo(info.lastSave) + (info.unsaved ? " (changes waiting)" : "") }),
    ]);
    if (info.broken) {
      const saveButton = el("button", { type: "button", textContent: "Save page for fixing" });
      saveButton.addEventListener("click", () => savePage(site));
      const dismiss = el("button", { type: "button", textContent: "Dismiss" });
      dismiss.addEventListener("click", () => send({ type: "clear-warning", site }).then(show));
      card.append(el("div", { className: "warning" }, [
        el("div", { textContent: `[${info.broken.code}] ${info.name} capture may be broken: no jobs were found on a jobs page.` }),
        saveButton,
        dismiss,
      ]));
    }
    if (info.noDetails) {
      const dismiss = el("button", { type: "button", textContent: "Dismiss" });
      dismiss.addEventListener("click", () => send({ type: "clear-warning", site }).then(show));
      const saved = info.noDetails.saved
        ? `A copy of the page was saved automatically in your downloads folder (${info.noDetails.saved.replaceAll("/", "\\")}) so this can be fixed.`
        : "Open the job again to save a copy of the page for fixing.";
      card.append(el("div", { className: "warning" }, [
        el("div", { textContent: `[${info.noDetails.code}] A ${info.name} job was open, but its details couldn't be read.` }),
        el("div", { className: "hint", textContent: saved }),
        dismiss,
      ]));
    }
    if (info.error) {
      card.append(el("div", { className: "warning" }, [
        el("div", { textContent: `[${info.error.code}] ${info.error.message}` }),
        el("div", { className: "hint", textContent: "Your jobs are kept; it tries again at the next save, or click Save now." }),
      ]));
    }
    card.append(runBlock(site));
    sitesBox.append(card);
  }
  showRuns(result);

  needsCount.textContent = result.needsLookTotal ? `(${result.needsLookTotal})` : "";
  document.getElementById("clear-needs").hidden = !result.needsLookTotal;
  needsList.replaceChildren();
  if (!result.needsLook.length) {
    needsList.append(el("li", { className: "hint", textContent: "Nothing waiting." }));
  }
  for (const job of result.needsLook) {
    const link = el("a", { href: job.url, textContent: job.title || job.url });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (/^https:\/\/(www\.linkedin\.com|(www\.)?mwejobs\.maryland\.gov|(www\.)?usajobs\.gov)\//.test(job.url)) browser.tabs.create({ url: job.url });
    });
    needsList.append(el("li", {}, [link, el("span", { className: "company", textContent: job.company || "" })]));
  }
}

document.getElementById("save-now").addEventListener("click", () => {
  message.textContent = "Saving…";
  send({ type: "save-now" })
    .then((result) => { show(result); message.textContent = "Saved."; })
    .catch((error) => { message.textContent = String(error.message || error); });
});

document.getElementById("save-page").addEventListener("click", () => savePage(null)); // the site of the open tab

// ---------- runs, under each website's name ----------

const TAGS = { scheduled: "Scheduled", running: "Running", done: "Done", stopped: "Stopped", missed: "Missed" };
const RUN_HINTS = {
  linkedin: "At the time you pick, Firefox opens LinkedIn's recommended jobs in a background tab, collects them, opens up to 10 new ones for details, then closes the tab. Firefox must be open.",
  mwe: "A run types each of your Job Finder titles into the Maryland Workforce Exchange search in your Firefox, then clicks the page numbers 2, 3, 4… one at a time with a pause between each, while the jobs are saved. It uses your open Maryland tab and leaves it open; with none open it uses its own.",
  indeed: "A run types each of your Job Finder titles (with Maryland) into Indeed's search in your Firefox, then clicks the next-page arrow a few times with a pause between each, while the jobs are saved. It uses your open Indeed tab and leaves it open; with none open it uses its own.",
  usajobs: "Firefox opens USAJOBS searches for each of your Job Finder titles in Maryland (a few result pages each, so it can take a while) in a background tab, collects the jobs, then closes the tab.",
  jobaps: "Reads the State of Maryland's job feed once (one request, nothing is browsed). This also happens by itself every few hours.",
};
const runTimes = {}; // the date and time typed into each site's box, kept while the panel redraws

function localInputValue(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Tomorrow at 6:10 AM, as a starting suggestion.
function suggestedTime() {
  const suggestion = new Date();
  suggestion.setDate(suggestion.getDate() + 1);
  suggestion.setHours(6, 10, 0, 0);
  return localInputValue(suggestion);
}

function runAction(payload) {
  message.textContent = "";
  send(payload).then(showAll).catch((error) => { message.textContent = String(error.message || error); });
}

// The buttons and list for one website's runs, filled in by showRuns.
function runBlock(site) {
  const when = el("input", { type: "datetime-local" });
  when.setAttribute("aria-label", "Date and time for a run");
  when.value = runTimes[site] || suggestedTime();
  when.addEventListener("input", () => { runTimes[site] = when.value; });
  const add = el("button", { type: "button", textContent: "Add" });
  add.addEventListener("click", () => {
    if (!when.value) {
      message.textContent = "Pick a date and time first.";
      return;
    }
    runAction({ type: "add-run", site, when: new Date(when.value).toISOString() });
  });
  const now = el("button", { type: "button", textContent: "Run now", title: "Start a run now" });
  now.addEventListener("click", () => runAction({ type: "run-now", site }));
  const buttons = [when, add, now];
  if (site === "mwe") {
    // A normal Maryland run opens up to 40 job pages for details; a full run opens every unread one (slow: for overnight).
    add.title = "Schedule a normal run (up to 40 job pages opened for details)";
    now.title = "Start a normal run now (up to 40 job pages opened for details)";
    const addFull = el("button", { type: "button", textContent: "Add full", title: "Schedule a full run (every unread job page opened; slow)" });
    addFull.addEventListener("click", () => {
      if (!when.value) {
        message.textContent = "Pick a date and time first.";
        return;
      }
      runAction({ type: "add-run", site, all: true, when: new Date(when.value).toISOString() });
    });
    const nowFull = el("button", { type: "button", textContent: "Run full now", title: "Start a full run now (every unread job page opened; slow)" });
    nowFull.addEventListener("click", () => runAction({ type: "run-now", site, all: true }));
    buttons.splice(2, 0, addFull);
    buttons.push(nowFull);
  }
  const alertBox = el("div", { className: "run-alert warning", hidden: true });
  const list = el("ul", { className: "run-list" });
  alertBox.dataset.site = site;
  list.dataset.site = site;
  return el("div", { className: "runs" }, [
    el("div", { className: "hint", textContent: RUN_HINTS[site] || "" }),
    alertBox,
    el("div", { className: "run-add" }, buttons),
    list,
  ]);
}

// Fills every site's run list and alert; also called every few seconds while the panel is open.
function showRuns(result) {
  for (const alertBox of document.querySelectorAll(".run-alert")) {
    const alert = result.runAlert && (result.runAlert.site || "linkedin") === alertBox.dataset.site ? result.runAlert : null;
    alertBox.hidden = !alert;
    alertBox.replaceChildren();
    if (alert) {
      const dismiss = el("button", { type: "button", textContent: "Dismiss" });
      dismiss.addEventListener("click", () => send({ type: "clear-run-alert" }).then(showAll));
      alertBox.append(el("div", { textContent: `[${alert.code}] ${alert.message}` }), dismiss);
    }
  }
  for (const list of document.querySelectorAll(".run-list")) {
    const mine = result.runs.filter((run) => (run.site || "linkedin") === list.dataset.site);
    list.replaceChildren();
    if (!mine.length) list.append(el("li", { className: "hint", textContent: "No runs scheduled." }));
    for (const run of mine) {
      const when = new Date(run.when).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      let detail = run.message || "";
      if (run.status === "running") detail = run.site === "mwe" || run.site === "indeed" ? `${run.pages || 0} pages read so far` : `${run.opened || 0} opened so far`;
      if (run.status === "stopped" && run.code) detail = `[${run.code}] ${detail}`;
      if (run.all) detail = `full run · ${detail}`;
      if (run.late && run.status !== "scheduled") detail = `ran late (Firefox was closed) · ${detail}`;
      const item = el("li", {}, [
        el("span", { className: `tag ${run.status}`, textContent: TAGS[run.status] || run.status }),
        el("span", { className: "when" }, [when, el("span", { className: "detail", textContent: detail })]),
      ]);
      if (run.status !== "running") {
        const remove = el("button", { type: "button", textContent: "×", title: run.status === "scheduled" ? "Cancel this run" : "Remove from the list" });
        remove.addEventListener("click", () => send({ type: "remove-run", id: run.id }).then(showAll));
        item.append(remove);
      }
      list.append(item);
    }
  }
}

function showAll(result) {
  show(result);
}

// While the panel is open, keep the tags up to date (a run takes a few minutes).
setInterval(() => send({ type: "popup-state" }).then(showRuns).catch(() => {}), 3000);

document.getElementById("check-update").addEventListener("click", () => {
  message.textContent = "Checking for updates…";
  send({ type: "check-update" })
    .then((reply) => { message.textContent = reply.message; })
    .catch((error) => { message.textContent = String(error.message || error); });
});

document.getElementById("clear-badge").addEventListener("click", () => {
  send({ type: "clear-badge" })
    .then(() => { message.textContent = "Count cleared. Jobs found from now on will be counted."; })
    .catch((error) => { message.textContent = String(error.message || error); });
});

// ---------- the fox and the newest flowers ----------

const gardenCanvas = document.getElementById("garden");
const petEnabled = document.getElementById("pet-enabled");
const petSpeed = document.getElementById("pet-speed");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const gardenCtx = gardenCanvas.getContext("2d");
const ratio = window.devicePixelRatio || 1;
gardenCanvas.width = 340 * ratio;
gardenCanvas.height = 116 * ratio;
gardenCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
gardenCtx.imageSmoothingEnabled = false;
// The panel fox only sits and naps (no walking).
const fox = new Pet.Pet({ width: 340, height: 116, scale: 3, panel: true, reduced: reducedMotion.matches });
let lastFrame = 0;

function animate(now) {
  requestAnimationFrame(animate); // first, so one bad frame can't stop the fox
  try {
    fox.update(now, lastFrame ? Math.max(0, Math.min(now - lastFrame, 100)) : 16);
    lastFrame = now;
    fox.draw(gardenCtx, now);
  } catch (error) {
    console.warn("web-job-scraper fox:", error);
  }
}
requestAnimationFrame(animate);

function showPet(result) {
  petEnabled.checked = result.pet.enabled;
  petSpeed.value = result.pet.speed;
  fox.setOptions({ speed: result.pet.speed, reduced: reducedMotion.matches });
  fox.setFlowers(result.garden || []);
}

// Only the fox reacts to clicks; the flowers are decoration.
gardenCanvas.addEventListener("click", (event) => {
  const rect = gardenCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const box = fox.foxBox();
  if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) fox.clicked();
});

petEnabled.addEventListener("change", () => send({ type: "set-pet", enabled: petEnabled.checked }).then(showPet));
petSpeed.addEventListener("change", () => send({ type: "set-pet", speed: petSpeed.value }).then(showPet));

document.getElementById("version").textContent = `v${browser.runtime.getManifest().version}`;
browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => { currentSite = siteOfTab(tabs[0] && tabs[0].url); }, () => {})
  .then(() => send({ type: "popup-state" })).then((result) => {
  show(result);
  showRuns(result);
  showPet(result);
});

// Fit markers: whether the extension has your Job Finder profile, and how fresh it is. Job Finder on this computer is
// asked for it every day (background.js); a file is for the web version or when Job Finder isn't running.
function showFitStatus() {
  browser.storage.local.get(["fitProfile", "fitProfileAt", "distanceError", "profileAuto", "profileCheckError"]).then((saved) => {
    const status = document.getElementById("fit-status");
    const auto = saved.profileAuto !== false;
    document.getElementById("profile-auto").checked = auto;
    const titles = (saved.fitProfile && saved.fitProfile.titles) || [];
    let text;
    if (!saved.fitProfile) {
      text = auto ? "No profile yet. Start Job Finder and click Check now."
        : "No profile yet: on Job Finder's Dashboard click Export for Web Job Scraper, then Load a file here.";
    } else if (!titles.length) {
      text = "Your Job Finder profile has no job titles yet, so nothing is marked.";
    } else {
      const when = saved.fitProfileAt
        ? new Date(saved.fitProfileAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "earlier";
      text = `Using ${titles.length} title${titles.length === 1 ? "" : "s"} and ${(saved.fitProfile.skills || []).length} skills ` +
        `from your Job Finder profile (updated ${when}${auto ? "; checked every day" : ""}).`;
    }
    if (auto && saved.profileCheckError) text += ` Last check: ${saved.profileCheckError}`;
    if (saved.distanceError) text += ` ${saved.distanceError}`;
    status.textContent = text;
  }).catch(() => {});
}
showFitStatus();

document.getElementById("check-profile").addEventListener("click", () => {
  message.textContent = "Asking Job Finder…";
  send({ type: "refresh-profile" })
    .then((reply) => {
      message.textContent = reply.ok ? "Profile updated from Job Finder." : (reply.skipped ? "Turn on the daily check first." : `Couldn't update: ${reply.error}`);
      showFitStatus();
    })
    .catch((error) => { message.textContent = String(error.message || error); });
});

document.getElementById("profile-auto").addEventListener("change", (event) => {
  send({ type: "set-profile-auto", enabled: event.target.checked }).then(showFitStatus).catch(() => {});
});

document.getElementById("clear-needs").addEventListener("click", () => {
  send({ type: "clear-needs-look" }).then((result) => { show(result); message.textContent = "Cleared."; }).catch((error) => {
    message.textContent = String(error.message || error);
  });
});

// A file opens a page of its own: Firefox closes the popup when a file picker opens.
document.getElementById("load-profile").addEventListener("click", () => {
  browser.tabs.create({ url: browser.runtime.getURL("profile/profile.html") });
  window.close();
});

// Sections fold from their headings; which are folded is remembered between openings.
(function foldableSections() {
  const sections = Array.from(document.querySelectorAll("main > section")).filter((section) => section.querySelector(":scope > h2"));
  const save = () => browser.storage.local.set({
    popupFolded: sections.filter((section) => section.classList.contains("folded")).map((section) => section.dataset.fold),
  }).catch(() => {});
  // First time, the sections used least start folded; after that the panel keeps whatever was chosen.
  const FOLDED_AT_FIRST = ["hidden-companies", "auto-sample", "pet-settings"];
  browser.storage.local.get("popupFolded").then((saved) => {
    const folded = new Set(saved.popupFolded || (saved.popupFolded === undefined ? FOLDED_AT_FIRST : []));
    for (const section of sections) {
      const heading = section.querySelector(":scope > h2");
      section.dataset.fold = section.dataset.fold || section.className.split(" ")[0] || section.id || heading.textContent.trim();
      const button = el("button", { type: "button", className: "fold" });
      button.append(...heading.childNodes);
      heading.append(button);
      const fold = (on) => { section.classList.toggle("folded", on); button.setAttribute("aria-expanded", String(!on)); };
      fold(folded.has(section.dataset.fold));
      button.addEventListener("click", () => { fold(!section.classList.contains("folded")); save(); });
    }
  }).catch(() => {});
})();

// "Nearest first": remembered in storage; the LinkedIn page script reads it.
browser.storage.local.get("sortByDistance").then((saved) => {
  const box = document.getElementById("sort-distance");
  box.checked = saved.sortByDistance !== false;
  box.addEventListener("change", () => browser.storage.local.set({ sortByDistance: box.checked }));
}).catch(() => {});

// Automatic page samples (on by default).
send({ type: "popup-state" }).then((result) => {
  const box = document.getElementById("auto-sample");
  box.checked = result.autoSample !== false;
  box.addEventListener("change", () => send({ type: "set-auto-sample", enabled: box.checked }));
});

// Hidden companies: the list from the X on LinkedIn cards, each with Unhide.
function showHiddenCompanies() {
  browser.storage.local.get("hiddenCompanies").then((saved) => {
    const names = saved.hiddenCompanies || [];
    const list = document.getElementById("hidden-list");
    list.replaceChildren(...names.map((name) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = name;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Unhide";
      button.addEventListener("click", () => {
        browser.storage.local.set({ hiddenCompanies: names.filter((other) => other !== name) }).then(showHiddenCompanies);
      });
      item.append(label, " ", button);
      return item;
    }));
    document.getElementById("hidden-empty").hidden = names.length > 0;
  }).catch(() => {});
}
showHiddenCompanies();

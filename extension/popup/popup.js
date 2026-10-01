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

function show(result) {
  sitesBox.replaceChildren();
  for (const [site, info] of Object.entries(result.sites)) {
    const toggle = el("input", { type: "checkbox", checked: info.enabled, title: "Capture on this site" });
    toggle.addEventListener("change", () => send({ type: "set-enabled", site, enabled: toggle.checked }).then(show));
    const card = el("div", { className: "site" }, [
      el("div", { className: "site-head" }, [el("span", { textContent: info.name }), el("label", {}, [toggle, " On"])]),
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
    sitesBox.append(card);
  }

  needsCount.textContent = result.needsLookTotal ? `(${result.needsLookTotal})` : "";
  needsList.replaceChildren();
  if (!result.needsLook.length) {
    needsList.append(el("li", { className: "hint", textContent: "Nothing waiting." }));
  }
  for (const job of result.needsLook) {
    const link = el("a", { href: job.url, textContent: job.title || job.url });
    link.addEventListener("click", (event) => {
      event.preventDefault();
      if (/^https:\/\/(www\.linkedin\.com|(www\.)?mwejobs\.maryland\.gov)\//.test(job.url)) browser.tabs.create({ url: job.url });
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

// ---------- scheduled LinkedIn runs ----------

const runList = document.getElementById("run-list");
const runWhen = document.getElementById("run-when");
const runAlert = document.getElementById("run-alert");
const TAGS = { scheduled: "Scheduled", running: "Running", done: "Done", stopped: "Stopped", missed: "Missed" };

function localInputValue(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Tomorrow at 6:10 AM, as a starting suggestion.
const suggestion = new Date();
suggestion.setDate(suggestion.getDate() + 1);
suggestion.setHours(6, 10, 0, 0);
runWhen.value = localInputValue(suggestion);

function showRuns(result) {
  runAlert.hidden = !result.runAlert;
  runAlert.replaceChildren();
  if (result.runAlert) {
    const dismiss = el("button", { type: "button", textContent: "Dismiss" });
    dismiss.addEventListener("click", () => send({ type: "clear-run-alert" }).then(showAll));
    runAlert.append(el("div", { textContent: `[${result.runAlert.code}] ${result.runAlert.message}` }), dismiss);
  }
  runList.replaceChildren();
  if (!result.runs.length) runList.append(el("li", { className: "hint", textContent: "No runs scheduled." }));
  for (const run of result.runs) {
    const when = new Date(run.when).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    let detail = run.message || "";
    if (run.status === "running") detail = `${run.opened || 0} opened so far`;
    if (run.status === "stopped" && run.code) detail = `[${run.code}] ${detail}`;
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
    runList.append(item);
  }
}

function showAll(result) {
  show(result);
  showRuns(result);
}

function runAction(payload) {
  message.textContent = "";
  send(payload).then(showAll).catch((error) => { message.textContent = String(error.message || error); });
}

document.getElementById("run-add").addEventListener("click", () => {
  if (!runWhen.value) {
    message.textContent = "Pick a date and time first.";
    return;
  }
  runAction({ type: "add-run", when: new Date(runWhen.value).toISOString() });
});
document.getElementById("run-now").addEventListener("click", () => runAction({ type: "run-now" }));
// While the panel is open, keep the tags up to date (a run takes a few minutes).
setInterval(() => send({ type: "popup-state" }).then(showRuns).catch(() => {}), 3000);

document.getElementById("check-update").addEventListener("click", () => {
  message.textContent = "Checking for updates…";
  send({ type: "check-update" })
    .then((reply) => { message.textContent = reply.message; })
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
gardenCanvas.height = 140 * ratio;
gardenCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
gardenCtx.imageSmoothingEnabled = false;
// The panel fox only sits and naps (no walking).
const fox = new Pet.Pet({ width: 340, height: 140, scale: 3, foxScale: 2, panel: true, reduced: reducedMotion.matches });
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
send({ type: "popup-state" }).then((result) => {
  show(result);
  showRuns(result);
  showPet(result);
});

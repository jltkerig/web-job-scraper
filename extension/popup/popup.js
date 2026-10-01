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
    .then((reply) => { message.textContent = `Saved to Downloads\\${reply.folder.replaceAll("/", "\\")}`; })
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
        ? `A copy of the page was saved automatically to Downloads\\${info.noDetails.saved.replaceAll("/", "\\")} so this can be fixed.`
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
      if (job.url.startsWith("https://www.linkedin.com/")) browser.tabs.create({ url: job.url });
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

document.getElementById("save-page").addEventListener("click", () => savePage("linkedin"));

document.getElementById("check-update").addEventListener("click", () => {
  message.textContent = "Checking for updates…";
  send({ type: "check-update" })
    .then((reply) => { message.textContent = reply.message; })
    .catch((error) => { message.textContent = String(error.message || error); });
});

document.getElementById("version").textContent = `v${browser.runtime.getManifest().version}`;
send({ type: "popup-state" }).then(show);

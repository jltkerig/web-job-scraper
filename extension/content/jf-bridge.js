// Runs only on your own Job Finder pages (http://127.0.0.1:5000). If Firefox won't let the extension's background script
// reach Job Finder directly, this page can: it is already talking to Job Finder. It answers only two read-only requests
// from the extension (your fit profile and distances) and hands your fit profile over whenever a Job Finder page opens.
(function () {
  "use strict";

  const ALLOWED = /^\/extension\/(?:fit-profile|distances)(?:\?|$)/;

  async function get(path) {
    const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "jf-fetch" || !ALLOWED.test(String(message.path || ""))) return undefined;
    return get(message.path).then((data) => ({ ok: true, data })).catch((error) => ({ ok: false, error: String((error && error.message) || error) }));
  });

  async function push() {
    try {
      await browser.runtime.sendMessage({ type: "fit-profile-push", profile: await get("/extension/fit-profile") });
    } catch (error) {
      // Job Finder or the extension wasn't ready; the next push (or the extension's own request) tries again.
    }
  }
  push();
  setInterval(push, 2 * 60 * 1000);
})();

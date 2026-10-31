// Load profile: reads the file Job Finder exports ("Export for Web Job Scraper") and hands it to background.js.
// A page of its own because Firefox closes the popup when a file picker opens.
(() => {
  "use strict";
  const input = document.getElementById("file");
  const result = document.getElementById("result");

  function say(text, ok) {
    result.textContent = text;
    result.className = ok ? "ok" : "error";
    result.hidden = false;
  }

  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let profile;
    try {
      profile = JSON.parse(await file.text());
    } catch {
      say("That file couldn't be read as a Job Finder profile.", false);
      return;
    }
    const reply = await browser.runtime.sendMessage({ type: "load-profile", profile });
    if (reply && reply.ok) {
      say(`Loaded ${reply.titles} job title${reply.titles === 1 ? "" : "s"} and ${reply.skills} skills. ` +
        (profile.home && profile.home.lat != null ? "Distances are on." : "No Home ZIP in it, so distances are off.") +
        " Reload any LinkedIn tabs to see the markers.", true);
    } else {
      say((reply && reply.error) || "The profile couldn't be loaded.", false);
    }
  });
})();

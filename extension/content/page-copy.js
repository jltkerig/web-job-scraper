// A copy of the open page for fixing, for pages the extension doesn't run on (Google, or any page you stumble upon).
// background.js runs this in the active tab only when you press "Save this page for fixing" there; the value of the last
// expression is what comes back. Without scripts, and without anything typed into a field: a saved copy sits in plain
// text in the downloads folder, so it should hold the page layout and nothing about you that it can avoid.
(function () {
  "use strict";
  const copy = document.documentElement.cloneNode(true);
  for (const node of copy.querySelectorAll("script, noscript, template")) node.remove();
  for (const field of copy.querySelectorAll("input, textarea")) {
    field.removeAttribute("value");
    if (field.tagName === "TEXTAREA") field.textContent = "";
  }
  return { url: location.href, html: copy.outerHTML };
})();

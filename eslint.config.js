const js = require("@eslint/js");
const globals = require("globals");
const security = require("eslint-plugin-security");
const noUnsanitized = require("eslint-plugin-no-unsanitized");

module.exports = [
  { ignores: ["dist/**", "docs/**", "node_modules/**", "searches/**", "debug/**", "tests/fixtures/**"] },
  js.configs.recommended,
  security.configs.recommended,
  noUnsanitized.configs.recommended,
  {
    files: ["extension/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, ...globals.webextensions, browser: "readonly" },
    },
  },
  // Extension files are classic scripts: their top-level functions are used by other files, so only locals are checked.
  {
    files: ["extension/**/*.js"],
    rules: { "no-unused-vars": ["error", { vars: "local", ignoreRestSiblings: true }] },
  },
  // background.js and runs.js are loaded together (manifest background scripts) and share one global scope.
  {
    files: ["extension/background.js"],
    languageOptions: {
      globals: Object.fromEntries(
        ["addRun", "catchUpRuns", "isRunTab", "removeRun", "runSawJobs", "runTabClosed", "runsForPopup", "startRun"]
          .map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: ["extension/runs.js"],
    languageOptions: {
      globals: Object.fromEntries(
        ["ERRORS", "flush", "localDay", "persist", "ready", "refreshFeed", "refreshProfile", "settleFox", "state", "updateBadge"]
          .map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: ["extension/popup/popup.js"],
    languageOptions: { globals: { Pet: "readonly" } },
  },
  {
    files: ["tests/**/*.js", "eslint.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
];

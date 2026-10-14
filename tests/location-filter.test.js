// Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
require("../extension/sites/location-filter.js");

const { outsideUS } = globalThis.LocationFilter;

test("jobs placed in another country are dropped", () => {
  for (const place of ["Türkiye (Remote)", "Fame Marketing • Türkiye (Remote)", "Greater Istanbul", "Turkey",
    "London, England, United Kingdom (Hybrid)", "Hyderabad, Telangana, India (On-site)", "Philippines (Remote)",
    "Toronto, ON, Canada", "EMEA (Remote)", "Berlin, Germany"]) {
    assert.strictEqual(outsideUS(place), true, place);
  }
});

test("U.S. places, unclear places and empty places are kept", () => {
  for (const place of ["", "Remote", "United States (Remote)", "Baltimore, MD (Hybrid)", "Turkey, NC", "Austin, TX",
    "United States or Canada (Remote)", "Greater Baltimore", "Anywhere", "Georgia, United States", "Washington DC-Baltimore Area"]) {
    assert.strictEqual(outsideUS(place), false, place);
  }
});

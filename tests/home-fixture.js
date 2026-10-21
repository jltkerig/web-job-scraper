// The home used by the profile tests. These are made-up example values. To test with your own, copy this file to
// tests/home-fixture.local.js (ignored by git) and put your home in it; it needs the same three exports.
let fixture;
try {
  fixture = require("./home-fixture.local.js");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
  fixture = {
    // zip, state and coordinates of the home, as Job Finder's profile file carries them
    home: { zip: "17101", state: "PA", lat: 40.2759, lon: -76.885 },
    // a place in the home's own town, spelled the way LinkedIn writes it
    place: "Harrisburg, PA",
    // the trip text expected for [place, "Towson, Maryland, United States", "Lancaster", "Greater Baltimore Area",
    // "Austin, TX (Hybrid)", "Nowhereville, ZZ"] from that home
    distances: ["under 1 mi · ~1 min", "63 mi · ~105 min", "35 mi · ~70 min", "69 mi · ~115 min", "1,359 mi · ~31 hr", null],
  };
}
module.exports = fixture;

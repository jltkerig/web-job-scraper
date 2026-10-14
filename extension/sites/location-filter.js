// Jobs placed outside the United States are not saved: LinkedIn mixes "Türkiye (Remote)", "London, England, United
// Kingdom" and the like into the lists, and Job Finder would only reject them again. Only a location that names a
// country or region outside the U.S. and shows no sign of the U.S. is dropped; anything unclear is kept.
(function (root) {
  "use strict";

  const OUTSIDE = new RegExp("\\b(?:" + [
    "t[uü]rk(?:iye|ey)", "istanbul", "ankara", "izmir",
    "india", "pakistan", "bangladesh", "sri lanka", "nepal",
    "united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "ireland", "london",
    "canada", "mexico", "brazil", "argentina", "colombia", "chile", "peru",
    "germany", "france", "spain", "italy", "netherlands", "belgium", "poland", "portugal", "romania", "bulgaria",
    "greece", "serbia", "croatia", "ukraine", "sweden", "norway", "denmark", "finland", "switzerland", "austria",
    "czech(?:ia| republic)", "hungary", "lithuania", "latvia", "estonia",
    "philippines", "vietnam", "indonesia", "malaysia", "singapore", "thailand", "japan", "china", "hong kong",
    "south korea", "taiwan", "australia", "new zealand",
    "united arab emirates", "uae", "dubai", "saudi arabia", "israel", "egypt", "nigeria", "kenya", "south africa",
    "morocco", "ghana",
    "emea", "apac", "latam", "europe", "asia",
  ].join("|") + ")\\b", "i");

  // Signs of the United States: its name, or one of its state codes after a comma ("Austin, TX"). Canada's provinces
  // (ON, BC ...) are not on the list.
  const US_NAME = /\b(?:united states|u\.s\.a?\.?|usa)\b/i;
  const US_STATE = /,\s*(?:A[LKSZR]|C[AOT]|D[EC]|F[LM]|G[AU]|HI|I[ADLN]|K[SY]|LA|M[ADEHINOPST]|N[CDEHJMVY]|O[HKR]|P[AR]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])\b/;

  function outsideUS(location) {
    const text = String(location || "").trim();
    return Boolean(text) && OUTSIDE.test(text) && !US_NAME.test(text) && !US_STATE.test(text);
  }

  root.LocationFilter = { outsideUS };
})(typeof globalThis !== "undefined" ? globalThis : this);

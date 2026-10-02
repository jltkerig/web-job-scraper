// A stand-in reader for sites the extension doesn't read yet (Indeed, USAJOBS). It finds no jobs and saves nothing;
// it only lets the panel's "Save this page for fixing" button work there, so the page's real layout can be
// collected and a proper reader written for it. Used by background.js and content/capture.js.
(function (root) {
  "use strict";

  root.SampleParse = {
    SITE: "sample", NAME: "Sample", jobUrl: () => "", idFromUrl: () => null, pageKind: () => "other",
    fromVoyager: () => [], fromDom: () => [], fromEmbedded: () => [], expectsJobs: () => false,
    onJobsPage: () => true, // every page there reports in, so background.js can keep a sample of each kind
    detailId: () => null,
  };
  // On a page where no real reader loaded first, capture.js uses this one.
  root.CaptureParse = root.CaptureParse || root.SampleParse;
})(typeof globalThis !== "undefined" ? globalThis : this);

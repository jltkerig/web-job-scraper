// The fox and its garden, in a strip along the whole bottom of LinkedIn's job pages. It's decoration: each flower
// is a job still to collect, and the fox sleeps once they're all collected. It sits in a closed shadow root so the
// site's styles can't reach it, and clicks pass through to the page everywhere except on the fox.
(function () {
  "use strict";
  if (window.top !== window) return;

  const SITE = "linkedin";
  const HEIGHT = 128;
  const SCALE = 3;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let host = null;
  let canvas = null;
  let ctx = null;
  let foxSpot = null;
  let pet = null;
  let settings = null;
  let garden = [];
  let frameRequest = null;
  let last = 0;
  let resizeTimer = null;

  function onJobsPage() {
    return location.pathname.startsWith("/jobs");
  }

  function wanted() {
    return Boolean(settings && settings.enabled && (settings.sites || {})[SITE] !== false && onJobsPage());
  }

  function stripWidth() {
    return document.documentElement.clientWidth || window.innerWidth;
  }

  // ---------- building the strip ----------

  function sizeCanvas(width) {
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = `${width}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function build() {
    host = document.createElement("div");
    host.style.cssText = `position:fixed;z-index:2147483000;pointer-events:none;left:0;right:0;bottom:0;height:${HEIGHT}px;`;
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      canvas { position: absolute; left: 0; bottom: 0; height: ${HEIGHT}px; image-rendering: pixelated; pointer-events: none; }
      .fox { position: absolute; pointer-events: auto; cursor: pointer; }`;
    canvas = document.createElement("canvas");
    foxSpot = document.createElement("div");
    foxSpot.className = "fox";
    shadow.append(style, canvas, foxSpot);
    ctx = canvas.getContext("2d");
    const width = stripWidth();
    sizeCanvas(width);
    pet = new globalThis.Pet.Pet({ width, height: HEIGHT, scale: SCALE, speed: settings.speed, reduced: reducedMotion.matches });
    pet.setFlowers(garden);
    // The fox is the only thing to click: it wakes up, or hops.
    foxSpot.addEventListener("click", () => pet.clicked());
    (document.body || document.documentElement).appendChild(host);
    start();
  }

  function remove() {
    stop();
    if (host) host.remove();
    host = canvas = ctx = foxSpot = pet = null;
  }

  // Keeps the fox's clickable spot on the fox (it moves every frame).
  function placeFoxSpot() {
    const box = pet.foxBox();
    const css = `left:${Math.round(box.x)}px;top:${Math.max(0, Math.round(box.y))}px;width:${box.w}px;height:${box.h}px;`;
    if (foxSpot.lastCss !== css) {
      foxSpot.lastCss = css;
      foxSpot.style.cssText = css;
    }
  }

  // ---------- animation loop (paused while the tab is hidden) ----------

  function tick(now) {
    frameRequest = null;
    if (!pet) return;
    const dt = last ? Math.min(now - last, 100) : 16;
    last = now;
    pet.update(now, dt);
    pet.draw(ctx, now);
    placeFoxSpot();
    frameRequest = requestAnimationFrame(tick);
  }

  function start() {
    if (!frameRequest && !document.hidden && pet) {
      last = 0;
      frameRequest = requestAnimationFrame(tick);
    }
  }

  function stop() {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = null;
  }

  // ---------- keeping in step with the extension and the page ----------

  function apply() {
    if (!wanted()) return remove();
    if (!host) return build();
    pet.setOptions({ speed: settings.speed, reduced: reducedMotion.matches });
    pet.setFlowers(garden);
    return undefined;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "pet-update") return undefined;
    settings = message.pet;
    garden = message.garden || [];
    apply();
    if (pet && message.added > 0) pet.captured(message.added);
    return undefined;
  });

  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reducedMotion.addEventListener("change", () => pet && pet.setOptions({ reduced: reducedMotion.matches }));
  document.addEventListener("scroll", () => pet && pet.scrolling(), { capture: true, passive: true });
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!pet) return;
      const width = stripWidth();
      sizeCanvas(width);
      pet.resize(width);
    }, 150);
  });

  // LinkedIn changes pages without reloading: show the strip only on jobs pages.
  let path = location.pathname;
  setInterval(() => {
    if (location.pathname !== path) {
      path = location.pathname;
      apply();
    }
  }, 1000);

  browser.runtime.sendMessage({ type: "pet-state" }).then((state) => {
    settings = state.pet;
    garden = state.garden || [];
    apply();
  }).catch(() => {});
})();

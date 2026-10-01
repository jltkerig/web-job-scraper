// The fox and its garden, in a strip along the whole bottom of LinkedIn's job pages. It's decoration: each flower
// is a job still to collect, and the fox sleeps once they're all collected. It sits in a closed shadow root so the
// site's styles can't reach it, and clicks pass through to the page everywhere except on the fox and its buttons.
// When the strip gets in the way, the – button shrinks it to a small fox badge in the corner (remembered for every
// tab); clicking the badge brings it back.
(function () {
  "use strict";
  if (window.top !== window) return;

  const SITE = "linkedin";
  const HEIGHT = 152;
  const SCALE = 3;
  const BADGE = 48;
  const STRIP_CSS = `position:fixed;z-index:2147483000;pointer-events:none;left:0;right:0;bottom:0;height:${HEIGHT}px;`;
  const BADGE_CSS = `position:fixed;z-index:2147483000;pointer-events:none;right:12px;bottom:12px;width:${BADGE}px;height:${BADGE}px;`;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let host = null;
  let canvas = null;
  let ctx = null;
  let foxSpot = null;
  let minimize = null;
  let badge = null;
  let minimized = false;
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

  // The page's width. While LinkedIn redraws the page it can briefly report 0, which would shrink the strip to
  // nothing, so implausible widths fall back to the window's.
  function stripWidth() {
    const width = document.documentElement.clientWidth;
    return width >= 200 ? width : Math.max(window.innerWidth || 0, 320);
  }

  // LinkedIn redraws the page body as you search and can drop elements it didn't put there, so the strip hangs off
  // the <html> element instead, and is put back if it ever goes missing.
  function attach() {
    if (host && !host.isConnected) document.documentElement.appendChild(host);
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

  function button(className, title, text) {
    const node = document.createElement("button");
    node.type = "button";
    node.className = className;
    node.title = title;
    node.setAttribute("aria-label", title);
    if (text) node.textContent = text;
    return node;
  }

  function build() {
    host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      canvas.strip { position: absolute; left: 0; bottom: 0; height: ${HEIGHT}px; image-rendering: pixelated; pointer-events: none; }
      .fox { position: absolute; pointer-events: auto; cursor: pointer; }
      button { pointer-events: auto; cursor: pointer; font: 600 14px/1 system-ui, sans-serif; }
      .minimize { position: absolute; right: 10px; top: 4px; width: 24px; height: 24px; padding: 0; border-radius: 50%;
        border: 1px solid rgba(43, 26, 18, .35); background: rgba(255, 255, 255, .85); color: #2b1a12; }
      .minimize:hover, .badge:hover { background: #fff; }
      .badge { position: absolute; inset: 0; padding: 0; border-radius: 50%; border: 2px solid #e87a2a;
        background: #fff7ee; box-shadow: 0 2px 8px rgba(0, 0, 0, .2); display: grid; place-items: center; }
      .badge canvas { width: 40px; height: 40px; image-rendering: pixelated; }
      [hidden] { display: none !important; }`;
    canvas = document.createElement("canvas");
    canvas.className = "strip";
    foxSpot = document.createElement("div");
    foxSpot.className = "fox";
    minimize = button("minimize", "Minimize the fox", "–");
    badge = button("badge", "Show the fox");
    const face = document.createElement("canvas");
    face.width = 64;
    face.height = 64;
    globalThis.PetSprites.draw(face.getContext("2d"), globalThis.PetSprites.FOX.sit, 0, 0, 1, true, globalThis.PetSprites.FOX_SIZE);
    badge.append(face);
    shadow.append(style, canvas, foxSpot, minimize, badge);
    ctx = canvas.getContext("2d");
    const width = stripWidth();
    sizeCanvas(width);
    pet = new globalThis.Pet.Pet({ width, height: HEIGHT, scale: SCALE, foxScale: 2, speed: settings.speed, reduced: reducedMotion.matches });
    pet.setFlowers(garden);
    // The fox is the only thing in the strip to click: it wakes up, or hops.
    foxSpot.addEventListener("click", () => pet.clicked());
    minimize.addEventListener("click", () => setMinimized(true));
    badge.addEventListener("click", () => setMinimized(false));
    attach();
    showMinimized();
  }

  function remove() {
    stop();
    if (host) host.remove();
    host = canvas = ctx = foxSpot = minimize = badge = pet = null;
  }

  // ---------- minimizing ----------

  function showMinimized() {
    if (!host) return;
    host.style.cssText = minimized ? BADGE_CSS : STRIP_CSS;
    canvas.hidden = foxSpot.hidden = minimize.hidden = minimized;
    badge.hidden = !minimized;
    if (minimized) {
      stop(); // nothing animates while the fox is tucked away
    } else {
      const width = stripWidth();
      sizeCanvas(width);
      pet.resize(width);
      start();
    }
  }

  // Remembered for every tab (storage.onChanged below keeps open tabs in step).
  function setMinimized(value) {
    minimized = Boolean(value);
    browser.storage.local.set({ petMinimized: minimized }).catch(() => {});
    showMinimized();
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
    const dt = last ? Math.max(0, Math.min(now - last, 100)) : 16;
    last = now;
    // Ask for the next frame first: a mistake in one frame must never stop the fox for good.
    frameRequest = requestAnimationFrame(tick);
    try {
      pet.update(now, dt);
      pet.draw(ctx, now);
      placeFoxSpot();
    } catch (error) {
      console.warn("web-job-scraper fox:", error);
    }
  }

  function start() {
    if (!frameRequest && !document.hidden && pet && !minimized) {
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
      if (!pet || minimized) return;
      const width = stripWidth();
      sizeCanvas(width);
      pet.resize(width);
    }, 150);
  });

  // LinkedIn changes pages without reloading: show the strip only on jobs pages, and put it back if a redraw
  // removed it.
  let path = location.pathname;
  setInterval(() => {
    if (location.pathname !== path) {
      path = location.pathname;
      apply();
    }
    attach();
  }, 1000);

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.petMinimized) return;
    minimized = Boolean(changes.petMinimized.newValue);
    showMinimized();
  });

  Promise.all([browser.runtime.sendMessage({ type: "pet-state" }), browser.storage.local.get("petMinimized")])
    .then(([state, saved]) => {
      settings = state.pet;
      garden = state.garden || [];
      minimized = Boolean(saved.petMinimized);
      apply();
    }).catch(() => {});
})();

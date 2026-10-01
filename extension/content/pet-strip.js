// The fox and the newest flowers, in a strip at the bottom-right of LinkedIn's job pages.
// It sits in a closed shadow root so the site's styles can't reach it, and clicks pass through to the page except
// on the fox (click, drag to move the strip) and the flowers (click for the job).
(function () {
  "use strict";
  if (window.top !== window) return;

  const SITE = "linkedin";
  const WIDTH = 330;
  const HEIGHT = 86;
  const SCALE = 2;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let host = null;
  let canvas = null;
  let ctx = null;
  let card = null;
  let hits = null;
  let pet = null;
  let settings = null;
  let garden = [];
  let frameRequest = null;
  let last = 0;

  function onJobsPage() {
    return location.pathname.startsWith("/jobs");
  }

  function wanted() {
    return Boolean(settings && settings.enabled && (settings.sites || {})[SITE] !== false && onJobsPage());
  }

  // ---------- building the strip ----------

  function build(position) {
    host = document.createElement("div");
    host.style.cssText = "position:fixed;z-index:2147483000;pointer-events:none;width:" + WIDTH + "px;height:" + HEIGHT +
      "px;right:" + (position.right ?? 16) + "px;bottom:" + (position.bottom ?? 0) + "px;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `<style>
      :host { all: initial; }
      canvas { position: absolute; inset: 0; width: ${WIDTH}px; height: ${HEIGHT}px; image-rendering: pixelated; pointer-events: none; }
      .hit { position: absolute; pointer-events: auto; cursor: pointer; }
      .hit.fox { cursor: grab; }
      .card { position: absolute; bottom: ${HEIGHT + 4}px; max-width: 260px; padding: 10px 12px; border-radius: 8px;
        background: #ffffff; color: #1f2328; border: 1px solid #d9dde3; box-shadow: 0 4px 14px rgba(0,0,0,.15);
        font: 13px/1.4 system-ui, sans-serif; pointer-events: auto; }
      .card strong { display: block; }
      .card .meta { color: #5b6470; }
      .card a { color: #2f6fd6; }
      .card button { position: absolute; top: 4px; right: 6px; border: 0; background: none; font-size: 16px; cursor: pointer; color: #5b6470; }
      @media (prefers-color-scheme: dark) {
        .card { background: #1f2126; color: #e8eaed; border-color: #3a3e46; }
        .card .meta, .card button { color: #a3a9b3; }
        .card a { color: #6ea0ff; }
      }
    </style><canvas></canvas><div class="hits"></div>`;
    canvas = shadow.querySelector("canvas");
    hits = shadow.querySelector(".hits");
    const ratio = window.devicePixelRatio || 1;
    canvas.width = WIDTH * ratio;
    canvas.height = HEIGHT * ratio;
    ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    pet = new globalThis.Pet.Pet({ width: WIDTH, height: HEIGHT, scale: SCALE, speed: settings.speed, reduced: reducedMotion.matches });
    pet.setFlowers(garden);
    (document.body || document.documentElement).appendChild(host);
    shadow.addEventListener("click", (event) => {
      if (card && !card.contains(event.target) && !event.target.classList.contains("hit")) closeCard();
    });
    hits.shadow = shadow;
    start();
  }

  function remove() {
    stop();
    if (host) host.remove();
    host = canvas = ctx = card = hits = pet = null;
  }

  // ---------- clickable spots (the rest of the strip lets clicks through) ----------

  function placeHits() {
    const boxes = [{ ...pet.foxBox(), fox: true }, ...pet.flowerBoxes()];
    while (hits.children.length < boxes.length) {
      const spot = document.createElement("div");
      spot.className = "hit";
      hits.appendChild(spot);
      wireHit(spot);
    }
    while (hits.children.length > boxes.length) hits.lastChild.remove();
    boxes.forEach((box, i) => {
      const spot = hits.children[i];
      spot.box = box;
      // Only touch the page when something moved (this runs every frame).
      const css = `left:${Math.round(box.x)}px;top:${Math.max(0, Math.round(box.y))}px;width:${box.w}px;height:${box.h}px;`;
      if (spot.lastCss !== css) {
        spot.lastCss = css;
        spot.style.cssText = css;
      }
      const title = box.fox ? "Drag to move" : `${box.job.title}${box.job.company ? ` · ${box.job.company}` : ""}`;
      if (spot.title !== title) {
        spot.title = title;
        spot.classList.toggle("fox", Boolean(box.fox));
      }
    });
  }

  function wireHit(spot) {
    spot.addEventListener("mouseenter", () => { if (spot.box.fox) pet.hover = true; });
    spot.addEventListener("mouseleave", () => { if (spot.box.fox) pet.hover = false; });
    spot.addEventListener("mousedown", (event) => {
      if (!spot.box.fox || event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const right = parseFloat(host.style.right);
      const bottom = parseFloat(host.style.bottom);
      let dragged = false;
      const move = (e) => {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!dragged && Math.hypot(dx, dy) < 4) return;
        dragged = true;
        host.style.right = `${Math.min(Math.max(0, right - dx), window.innerWidth - WIDTH)}px`;
        host.style.bottom = `${Math.min(Math.max(0, bottom - dy), window.innerHeight - HEIGHT)}px`;
      };
      const up = () => {
        window.removeEventListener("mousemove", move, true);
        window.removeEventListener("mouseup", up, true);
        if (dragged) {
          browser.storage.local.set({ petPosition: { right: parseFloat(host.style.right), bottom: parseFloat(host.style.bottom) } });
        } else {
          pet.clicked();
        }
      };
      window.addEventListener("mousemove", move, true);
      window.addEventListener("mouseup", up, true);
    });
    spot.addEventListener("click", (event) => {
      if (spot.box.fox) return;
      event.stopPropagation();
      showCard(spot.box);
    });
  }

  function closeCard() {
    if (card) card.remove();
    card = null;
  }

  function showCard(box) {
    closeCard();
    const job = box.job;
    card = document.createElement("div");
    card.className = "card";
    card.style.left = `${Math.max(0, Math.min(box.x - 20, WIDTH - 260))}px`;
    const close = document.createElement("button");
    close.textContent = "×";
    close.title = "Close";
    close.addEventListener("click", closeCard);
    const title = document.createElement("strong");
    title.textContent = job.title || "Job";
    const meta = document.createElement("div");
    meta.className = "meta";
    const stage = { sprout: "Seen", bloom: "Opened", sparkle: "Applied", wilt: "No longer open" }[globalThis.Pet.flowerStage(job)];
    meta.textContent = [job.company, job.salary, stage].filter(Boolean).join(" · ");
    const link = document.createElement("a");
    link.href = job.url;
    link.textContent = "Open job";
    card.append(close, title, meta, link);
    hits.shadow.appendChild(card);
  }

  // ---------- animation loop (paused while the tab is hidden) ----------

  function tick(now) {
    frameRequest = null;
    if (!pet) return;
    const dt = last ? Math.min(now - last, 100) : 16;
    last = now;
    pet.update(now, dt);
    pet.draw(ctx, now);
    placeHits();
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

  async function apply() {
    if (!wanted()) return remove();
    if (!host) {
      const { petPosition } = await browser.storage.local.get("petPosition");
      if (!host && wanted()) build(petPosition || {});
    } else {
      pet.setOptions({ speed: settings.speed, reduced: reducedMotion.matches });
      pet.setFlowers(garden);
    }
    return undefined;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "pet-update") return undefined;
    settings = message.pet;
    garden = message.garden || [];
    apply().then(() => {
      if (pet && message.added > 0) pet.captured(message.added);
    });
    return undefined;
  });

  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  reducedMotion.addEventListener("change", () => pet && pet.setOptions({ reduced: reducedMotion.matches }));
  document.addEventListener("scroll", () => pet && pet.scrolling(), { capture: true, passive: true });

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

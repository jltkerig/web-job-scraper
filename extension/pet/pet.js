// The fox's behaviour and the garden, drawn on a canvas. Used by the strip along the bottom of LinkedIn's job pages
// (content/pet-strip.js) and by the toolbar panel. It's decoration that changes as you work: each flower is a job
// the extension has spotted but not collected yet, and an empty garden means the fox can sleep.
(function (root) {
  "use strict";

  const S = root.PetSprites;
  const SPEEDS = { calm: 0.6, normal: 1, playful: 1.6 };
  const FLOWER_GAP = 12; // sprite pixels from one flower to the next (times the scale on the canvas)

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function lateNight() {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 6;
  }

  // A flower's petal colours, the same every time for the same job.
  function petals(job) {
    const text = String(job.key || job.url || job.title || "");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    const [petal, light] = S.PETALS[hash % S.PETALS.length];
    return { B: petal, b: light };
  }

  class Pet {
    // options: width/height (canvas px), scale, speed ("calm" | "normal" | "playful"), reduced (fewer animations),
    // panel (true in the toolbar panel: sit and nap only, no walking).
    constructor(options) {
      this.width = options.width;
      this.height = options.height;
      this.scale = options.scale || 2;
      this.panel = Boolean(options.panel);
      this.jobs = [];
      this.flowers = [];
      this.popups = []; // "+1" and "z" texts floating up
      this.x = this.width - S.FOX_SIZE * this.scale - 8;
      this.facingLeft = true;
      this.speed = 1;
      this.reduced = false;
      this.setOptions(options);
      this.blinkAt = performance.now() + rand(2500, 6000);
      this.setState("sit", 4000);
    }

    setOptions({ speed, reduced }) {
      if (speed) this.speed = SPEEDS[speed] || 1;
      if (reduced !== undefined) this.reduced = Boolean(reduced);
      if (this.reduced && this.state !== "sit") this.setState("sit", Infinity);
    }

    // The jobs still waiting to be collected, newest first. As many flowers as fit, newest on the right, leaving
    // room at the right end for the fox. When the garden empties, the fox settles down to sleep.
    setFlowers(jobs) {
      this.jobs = jobs;
      const gap = FLOWER_GAP * this.scale;
      const room = Math.max(0, Math.floor((this.width - S.FOX_SIZE * this.scale - 16) / gap));
      this.flowers = jobs.slice(0, room).reverse().map((job, i) => ({ job, colors: petals(job), x: 8 + i * gap }));
      if (!this.flowers.length && !["sleep", "stretch", "pounce"].includes(this.state)) this.nextIdle();
    }

    // The strip follows the window's width.
    resize(width) {
      this.width = width;
      const span = Math.max(0, width - S.FOX_SIZE * this.scale);
      this.x = Math.min(this.x, span);
      if (typeof this.target === "number") this.target = Math.min(this.target, span);
      this.setFlowers(this.jobs);
    }

    setState(name, duration, extra = {}) {
      this.state = name;
      this.stateStart = performance.now();
      this.stateEnd = this.stateStart + duration;
      Object.assign(this, { target: null, after: null }, extra);
    }

    // ---------- events from the page and the extension ----------

    captured(count) {
      if (this.reduced) return;
      this.popups.push({ text: `+${count}`, x: this.foxCenter(), y: this.groundY() - (S.FOX_SIZE + 3) * this.scale,
        born: performance.now() });
      if (this.state === "sleep") {
        this.setState("stretch", 700 / this.speed, { after: () => this.setState("pounce", 900 / this.speed) });
      } else {
        this.setState("pounce", 900 / this.speed);
      }
    }

    scrolling() {
      if (this.reduced || this.state === "sleep" || this.state === "pounce" || this.state === "stretch") return;
      if (this.state !== "watch") this.setState("watch", 1600);
      else this.stateEnd = performance.now() + 1600; // stays watching while the list keeps moving
    }

    clicked() {
      if (this.state === "sleep") this.setState("stretch", 700 / this.speed, { after: () => this.setState("sit", 5000) });
      else if (!this.reduced) this.setState("pounce", 700 / this.speed);
    }

    // ---------- idle life ----------

    nextIdle() {
      if (this.reduced) return this.setState("sit", Infinity);
      const hold = rand(20000, 60000) / this.speed;
      // Nothing left to collect: the fox's work is done, so it sleeps until a new job turns up.
      if (!this.flowers.length) return this.setState("sleep", hold * 4);
      const naps = lateNight() ? 0.5 : 0.18;
      const roll = Math.random();
      if (roll < naps) return this.setState("sleep", hold * 1.5);
      if (this.panel || roll < naps + 0.3) return this.setState("sit", hold);
      const span = this.width - S.FOX_SIZE * this.scale;
      return this.setState("walk", Infinity, { target: rand(0, span), after: () => this.setState("sit", rand(6000, 20000) / this.speed) });
    }

    update(now, dt) {
      if (now >= this.stateEnd) {
        const after = this.after;
        if (after) {
          this.after = null;
          after();
        } else {
          this.nextIdle();
        }
      }
      if (this.state === "walk" && this.target !== null) {
        const step = 22 * this.speed * this.scale * (dt / 1000);
        const gap = this.target - this.x;
        this.facingLeft = gap < 0;
        if (Math.abs(gap) <= step) {
          this.x = this.target;
          this.stateEnd = now; // arrived: `after` runs on the next update
        } else {
          this.x += Math.sign(gap) * step;
        }
      }
      if (now >= this.blinkAt + 160) this.blinkAt = now + rand(2500, 6000);
      this.popups = this.popups.filter((popup) => now - popup.born < 1400);
    }

    // ---------- drawing ----------

    groundY() {
      return this.height - 4;
    }

    foxCenter() {
      return this.x + (S.FOX_SIZE * this.scale) / 2;
    }

    foxBox() {
      const size = S.FOX_SIZE * this.scale;
      return { x: this.x, y: this.groundY() - size, w: size, h: size };
    }

    pose(now) {
      const blinking = now >= this.blinkAt && now < this.blinkAt + 160;
      const t = now - this.stateStart;
      switch (this.state) {
        case "walk":
          return { frame: S.FOX.walk[Math.floor(t / (150 / this.speed)) % 4] };
        case "sleep":
          return { frame: S.FOX.sleep[Math.floor(t / 900) % 2] };
        case "stretch":
          return { frame: S.FOX.crouch };
        case "watch":
          return { frame: blinking ? S.FOX.sitBlink : S.FOX.alert };
        case "pounce": {
          const part = t / (this.stateEnd - this.stateStart);
          if (part < 0.33) return { frame: S.FOX.crouch };
          if (part < 0.75) {
            // The jump stays inside the canvas, so the ears never get cut off.
            const room = Math.max(0, this.height - 4 - S.FOX_SIZE * this.scale);
            return { frame: S.FOX.leap, lift: Math.sin(((part - 0.33) / 0.42) * Math.PI) * Math.min(8 * this.scale, room) };
          }
          return { frame: S.FOX.stand };
        }
        default:
          return { frame: blinking ? S.FOX.sitBlink : S.FOX.sit };
      }
    }

    draw(ctx, now) {
      ctx.clearRect(0, 0, this.width, this.height);
      // Grass along the bottom, so the garden has ground to stand on.
      for (let x = 0; x < this.width; x += 6 * this.scale) S.draw(ctx, S.GRASS, x, this.groundY() - 2 * this.scale, this.scale);
      const [fw, fh] = S.FLOWER_SIZE;
      for (const flower of this.flowers) {
        S.draw(ctx, S.FLOWER, flower.x, this.groundY() - (fh - 1) * this.scale, this.scale, false, fw, flower.colors);
      }
      const { frame, lift = 0 } = this.pose(now);
      const size = S.FOX_SIZE * this.scale;
      S.draw(ctx, frame, this.x, this.groundY() - size - lift, this.scale, this.facingLeft, S.FOX_SIZE);

      ctx.font = `bold ${5 * this.scale}px monospace`;
      ctx.textAlign = "center";
      for (const popup of this.popups) {
        const age = (now - popup.born) / 1400;
        ctx.globalAlpha = 1 - age;
        ctx.fillStyle = "#2f6fd6";
        ctx.fillText(popup.text, popup.x, popup.y - age * 18);
      }
      if (this.state === "sleep" && !this.reduced) {
        const cycle = ((now - this.stateStart) % 2400) / 2400;
        ctx.globalAlpha = 1 - cycle;
        ctx.fillStyle = "#5b6470";
        const side = this.facingLeft ? -1 : 1;
        ctx.fillText("z", this.foxCenter() + side * 10 * this.scale + cycle * 6 * side, this.groundY() - 16 * this.scale - cycle * 12);
      }
      ctx.globalAlpha = 1;
    }
  }

  root.Pet = { Pet };
})(typeof globalThis !== "undefined" ? globalThis : this);

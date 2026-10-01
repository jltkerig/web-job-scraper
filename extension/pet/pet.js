// The fox's behaviour and the garden, drawn on a canvas. Used by the strip along the bottom of LinkedIn's job pages
// (content/pet-strip.js) and by the toolbar panel. It's decoration that changes as you work: each flower is a job
// the extension has spotted but not collected yet, and an empty garden means the fox can sleep.
(function (root) {
  "use strict";

  const S = root.PetSprites;
  const SPEEDS = { calm: 0.6, normal: 1, playful: 1.6 };
  const FLOWER_GAP = 16; // sprite pixels from one flower to the next (times the scale on the canvas)
  const MAX_FLOWERS = 10; // the newest 10 jobs still to collect; more was too busy

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function lateNight() {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 6;
  }

  // A job's flower, the same every time for the same job: a foxglove or a bluebell in one of six colours, and now
  // and then (about one in twelve) a really tall foxglove.
  function flowerLook(job) {
    const text = String(job.key || job.url || job.title || "");
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    const kind = hash % 12 === 0 ? "giant" : (hash >>> 4) % 2 ? "bluebell" : "foxglove";
    const look = S.FLOWERS[kind];
    const [petal, light] = look.colours[(hash >>> 8) % look.colours.length];
    return { kind, frame: look.frame, size: look.size, colors: { B: petal, b: light } };
  }

  class Pet {
    // options: width/height (canvas px), scale, speed ("calm" | "normal" | "playful"), reduced (fewer animations),
    // panel (true in the toolbar panel: sit and nap only, no walking).
    constructor(options) {
      this.width = options.width;
      this.height = options.height;
      this.scale = options.scale || 2;
      // The fox has its own pixel size (it is drawn twice as finely as the flowers); by default it matches a 32-pixel
      // fox at the garden scale.
      this.foxScale = options.foxScale || (this.scale * 32) / S.FOX_SIZE;
      this.panel = Boolean(options.panel);
      this.jobs = [];
      this.flowers = [];
      this.popups = []; // "+1" and "z" texts floating up
      this.x = this.width - this.foxPx() - 8;
      this.facingLeft = true;
      this.speed = 1;
      this.reduced = false;
      this.setOptions(options);
      this.blinkAt = performance.now() + rand(2500, 6000);
      this.bee = null;
      this.nextBeeAt = performance.now() + rand(60000, 180000);
      this.setState("sit", 4000);
    }

    setOptions({ speed, reduced }) {
      if (speed) this.speed = SPEEDS[speed] || 1;
      if (reduced !== undefined) this.reduced = Boolean(reduced);
      if (this.reduced && this.state !== "sit") this.setState("sit", Infinity);
    }

    // The jobs still waiting to be collected, newest first. Up to 10 flowers (fewer if the canvas is narrow), newest
    // on the right, leaving room at the right end for the fox. When the garden empties, the fox settles down to sleep.
    setFlowers(jobs) {
      this.jobs = jobs;
      const gap = FLOWER_GAP * this.scale;
      const room = Math.max(0, Math.floor((this.width - this.foxPx() - 16) / gap));
      this.flowers = jobs.slice(0, Math.min(room, MAX_FLOWERS)).reverse()
        .map((job, i) => ({ job, ...flowerLook(job), x: 8 + i * gap }));
      if (!this.flowers.length && !["sleep", "stretch", "pounce"].includes(this.state)) this.nextIdle();
    }

    // The strip follows the window's width.
    resize(width) {
      this.width = width;
      const span = Math.max(0, width - this.foxPx());
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
      this.popups.push({ text: `+${count}`, x: this.foxCenter(), y: this.groundY() - (this.foxPx() + 3 * this.scale),
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
      const span = this.width - this.foxPx();
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
      this.updateBee(now, dt);
    }

    // ---------- the bee ----------

    // Every few minutes, while there are foxgloves, a bee flies in from one side, visits one to three of them and
    // leaves by the other side. Not in the panel, and not with reduce animations on.
    updateBee(now, dt) {
      const [bw, bh] = S.BEE_SIZE.map((n) => n * this.scale);
      if (!this.bee) {
        if (this.panel || this.reduced || !this.flowers.length || now < this.nextBeeAt) return;
        const fromLeft = Math.random() < 0.5;
        const picks = [...this.flowers].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(rand(0, 3)));
        this.bee = {
          x: fromLeft ? -bw : this.width, y: this.height * 0.2, facingLeft: !fromLeft,
          stops: picks.map((flower) => flower.job.key), hoverUntil: 0, exitX: fromLeft ? this.width : -bw,
        };
        if (this.state === "sit" || this.state === "walk") this.setState("watch", 2500); // the fox looks up
        return;
      }
      const bee = this.bee;
      if (bee.hoverUntil) {
        if (now < bee.hoverUntil) return;
        bee.hoverUntil = 0;
        bee.stops.shift();
      }
      // Next stop: a flower still in the garden (it may have been collected meanwhile), else off-screen.
      let target = null;
      while (bee.stops.length && !target) {
        const flower = this.flowers.find((item) => item.job.key === bee.stops[0]);
        if (flower) {
          const [fw, fh] = flower.size;
          target = { x: flower.x + (fw * this.scale - bw) / 2, y: Math.max(0, this.groundY() - fh * this.scale - bh), stop: true };
        } else {
          bee.stops.shift();
        }
      }
      if (!target) target = { x: bee.exitX, y: this.height * 0.15, stop: false };
      const dx = target.x - bee.x;
      const dy = target.y - bee.y;
      const distance = Math.hypot(dx, dy);
      const step = 45 * this.scale * this.speed * (dt / 1000);
      if (Math.abs(dx) > 1) bee.facingLeft = dx < 0;
      if (distance <= step) {
        bee.x = target.x;
        bee.y = target.y;
        if (target.stop) {
          bee.hoverUntil = now + rand(1500, 2500); // a little visit
        } else {
          this.bee = null;
          this.nextBeeAt = now + rand(90000, 240000) / this.speed;
        }
      } else {
        bee.x += (dx / distance) * step;
        bee.y += (dy / distance) * step;
      }
    }

    // ---------- drawing ----------

    groundY() {
      return this.height - 4;
    }

    // How many screen pixels wide (and tall) the fox is.
    foxPx() {
      return S.FOX_SIZE * this.foxScale;
    }

    foxCenter() {
      return this.x + this.foxPx() / 2;
    }

    foxBox() {
      const size = this.foxPx();
      return { x: this.x, y: this.groundY() - size, w: size, h: size };
    }

    pose(now) {
      const blinking = now >= this.blinkAt && now < this.blinkAt + 160;
      // The frame clock can be a moment behind the time a state began; a negative time would pick a frame that
      // doesn't exist (index -1) and the fox would vanish, so time in a state never goes below zero.
      const t = Math.max(0, now - this.stateStart);
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
            const room = Math.max(0, this.height - 4 - this.foxPx());
            return { frame: S.FOX.leap, lift: Math.sin(((part - 0.33) / 0.42) * Math.PI) * Math.min(16 * this.foxScale, room) };
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
      for (const flower of this.flowers) {
        const [fw, fh] = flower.size;
        S.draw(ctx, flower.frame, flower.x, this.groundY() - (fh - 1) * this.scale, this.scale, false, fw, flower.colors);
      }
      const { frame, lift = 0 } = this.pose(now);
      const size = this.foxPx();
      S.draw(ctx, frame, this.x, this.groundY() - size - lift, this.foxScale, this.facingLeft, S.FOX_SIZE);
      if (this.bee) {
        const bob = Math.sin(now / 180) * 1.5 * this.scale;
        S.draw(ctx, S.BEE[Math.floor(now / 80) % 2], this.bee.x, this.bee.y + bob, this.scale, this.bee.facingLeft,
          S.BEE_SIZE[0]);
      }

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
        ctx.fillText("z", this.foxCenter() + side * 20 * this.foxScale + cycle * 6 * side, this.groundY() - 32 * this.foxScale - cycle * 12);
      }
      ctx.globalAlpha = 1;
    }
  }

  root.Pet = { Pet };
})(typeof globalThis !== "undefined" ? globalThis : this);

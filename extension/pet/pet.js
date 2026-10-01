// The fox's behaviour and the garden, drawn on a canvas. Used by the strip on job sites (content/pet-strip.js)
// and by the toolbar panel. Job events always win over idle activities.
(function (root) {
  "use strict";

  const S = root.PetSprites;
  const SPEEDS = { calm: 0.6, normal: 1, playful: 1.6 };
  const FLOWER_GAP = 24; // canvas px from one flower to the next
  const STRIP_FLOWERS = 7;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function lateNight() {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 6;
  }

  // Which flower a job grows into.
  function flowerStage(job) {
    if (job.closed) return "wilt";
    if (job.applied) return "sparkle";
    if (job.level === "opened") return "bloom";
    return "sprout";
  }

  class Pet {
    // options: width/height (canvas px), scale, speed ("calm" | "normal" | "playful"), reduced (fewer animations),
    // panel (true in the toolbar panel: sit and nap only, no walking).
    constructor(options) {
      this.width = options.width;
      this.height = options.height;
      this.scale = options.scale || 2;
      this.panel = Boolean(options.panel);
      this.flowers = [];
      this.popups = []; // "+1" and "z" texts floating up
      this.x = this.width - S.FOX_SIZE * this.scale - 8;
      this.facingLeft = true;
      this.hover = false;
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

    // jobs come newest first; the newest flower is drawn on the right.
    setFlowers(jobs) {
      this.flowers = jobs.slice(0, STRIP_FLOWERS).reverse()
        .map((job, i) => ({ job, stage: flowerStage(job), x: 8 + i * FLOWER_GAP }));
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
      this.popups.push({ text: `+${count}`, x: this.foxCenter(), y: this.groundY() - 70, born: performance.now() });
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
      const naps = lateNight() ? 0.5 : 0.18;
      const roll = Math.random();
      const hold = rand(20000, 60000) / this.speed;
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

    flowerBoxes() {
      const [w, h] = S.FLOWER_SIZE;
      return this.flowers.map((flower) => ({
        x: flower.x, y: this.groundY() - h * this.scale, w: w * this.scale, h: h * this.scale, job: flower.job,
      }));
    }

    pose(now) {
      const blinking = now >= this.blinkAt && now < this.blinkAt + 160;
      const t = now - this.stateStart;
      switch (this.state) {
        case "walk":
          return { frame: S.FOX.walk[Math.floor(t / (150 / this.speed)) % 4] };
        case "sleep":
          return { frame: this.hover ? S.FOX.peek : S.FOX.sleep[Math.floor(t / 900) % 2] };
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
      const [, fh] = S.FLOWER_SIZE;
      for (const flower of this.flowers) {
        S.draw(ctx, S.FLOWERS[flower.stage], flower.x, this.groundY() - fh * this.scale, this.scale, false, 9);
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

  root.Pet = { Pet, flowerStage, STRIP_FLOWERS };
})(typeof globalThis !== "undefined" ? globalThis : this);

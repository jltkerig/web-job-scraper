// The fox's behaviour (no drawing). Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
require("../extension/pet/sprites.js");
require("../extension/pet/pet.js");

const { Pet, flowerStage } = globalThis.Pet;

function fox(options = {}) {
  return new Pet({ width: 330, height: 76, scale: 2, ...options });
}

test("flowers follow the job: sprout, bloom, sparkle, wilt", () => {
  assert.strictEqual(flowerStage({ level: "seen" }), "sprout");
  assert.strictEqual(flowerStage({ level: "opened" }), "bloom");
  assert.strictEqual(flowerStage({ level: "opened", applied: true }), "sparkle");
  assert.strictEqual(flowerStage({ level: "opened", applied: true, closed: true }), "wilt");
});

test("the strip shows the newest 7 flowers, newest on the right", () => {
  const pet = fox();
  pet.setFlowers(Array.from({ length: 9 }, (_, i) => ({ title: `job ${i}`, level: "seen" }))); // newest first
  assert.strictEqual(pet.flowers.length, 7);
  assert.strictEqual(pet.flowers[6].job.title, "job 0");
  assert.ok(pet.flowers[6].x > pet.flowers[0].x);
  assert.ok(pet.flowerBoxes().every((box) => box.x + box.w <= 330));
});

test("a captured job makes the fox pounce with +1, and wakes it first if napping", () => {
  const pet = fox();
  pet.captured(1);
  assert.strictEqual(pet.state, "pounce");
  assert.strictEqual(pet.popups[0].text, "+1");

  pet.setState("sleep", 60000);
  pet.captured(2);
  assert.strictEqual(pet.state, "stretch");
  pet.update(pet.stateEnd + 1, 16);
  assert.strictEqual(pet.state, "pounce");
});

test("scrolling makes it watch, but not while napping", () => {
  const pet = fox();
  pet.scrolling();
  assert.strictEqual(pet.state, "watch");
  pet.setState("sleep", 60000);
  pet.scrolling();
  assert.strictEqual(pet.state, "sleep");
});

test("with reduce animations on it only sits and blinks", () => {
  const pet = fox({ reduced: true });
  pet.captured(1);
  pet.scrolling();
  for (let i = 0; i < 20; i += 1) pet.nextIdle();
  assert.strictEqual(pet.state, "sit");
  assert.strictEqual(pet.popups.length, 0);
});

test("the panel fox never walks, and the strip fox walks within the strip", () => {
  const panel = fox({ panel: true });
  const strip = fox();
  const realRandom = Math.random;
  try {
    Math.random = () => 0.99; // never a nap, always the "walk" branch where allowed
    for (let i = 0; i < 10; i += 1) {
      panel.nextIdle();
      assert.notStrictEqual(panel.state, "walk");
    }
    strip.nextIdle();
    assert.strictEqual(strip.state, "walk");
    let now = performance.now();
    for (let i = 0; i < 2000 && strip.state === "walk"; i += 1) {
      now += 16;
      strip.update(now, 16);
      assert.ok(strip.x >= 0 && strip.x <= 330 - 64);
    }
    assert.notStrictEqual(strip.state, "walk"); // it arrived and sat down
  } finally {
    Math.random = realRandom;
  }
});

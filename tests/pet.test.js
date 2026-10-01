// The fox and its garden (no drawing). Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
require("../extension/pet/sprites.js");
require("../extension/pet/pet.js");

const { Pet } = globalThis.Pet;
const FOX_WIDTH = 32 * 3;

function fox(options = {}) {
  return new Pet({ width: 1200, height: 128, scale: 3, ...options });
}

function waiting(count) {
  // Jobs still to collect, newest first, as the background sends them.
  return Array.from({ length: count }, (_, i) => ({ key: `linkedin:${i}`, title: `job ${i}` }));
}

test("the garden shows at most 10 flowers, newest on the right, leaving room for the fox", () => {
  const pet = fox();
  pet.setFlowers(waiting(200));
  assert.strictEqual(pet.flowers.length, 10);
  const last = pet.flowers[pet.flowers.length - 1];
  assert.strictEqual(last.job.title, "job 0");
  assert.ok(last.x + 11 * 3 <= 1200 - FOX_WIDTH, "flowers run into the fox's corner");
});

test("a narrow window shows fewer flowers, and resizing lays them out again", () => {
  const pet = fox({ width: 340 });
  pet.setFlowers(waiting(50));
  const narrow = pet.flowers.length;
  assert.ok(narrow < 10);
  pet.resize(1200);
  assert.strictEqual(pet.flowers.length, 10);
  pet.resize(200);
  assert.ok(pet.x <= 200 - FOX_WIDTH + 1e-9);
});

test("each job keeps its flower: a foxglove or bluebell, sometimes a really tall foxglove", () => {
  const pet = fox();
  pet.setFlowers(waiting(10));
  const first = pet.flowers.map((flower) => `${flower.kind} ${flower.colors.B}`);
  pet.setFlowers(waiting(10));
  assert.deepStrictEqual(pet.flowers.map((flower) => `${flower.kind} ${flower.colors.B}`), first);

  // Across many jobs all three kinds turn up, giants rarely, and every flower fits under the strip's top.
  const kinds = { foxglove: 0, bluebell: 0, giant: 0 };
  for (let start = 0; start < 600; start += 10) {
    pet.setFlowers(Array.from({ length: 10 }, (_, i) => ({ key: `linkedin:${4400000000 + (start + i) * 7919}` })));
    for (const flower of pet.flowers) {
      kinds[flower.kind] += 1;
      assert.ok(flower.size[1] * 3 < 128, `${flower.kind} is taller than the strip`);
    }
  }
  assert.ok(kinds.foxglove > 100 && kinds.bluebell > 100, JSON.stringify(kinds));
  assert.ok(kinds.giant > 10 && kinds.giant < 120, JSON.stringify(kinds));
});

test("when the garden is empty the fox sleeps, and a new job wakes it with +1", () => {
  const pet = fox();
  pet.setFlowers(waiting(2));
  assert.strictEqual(pet.state, "sit");
  pet.setFlowers([]);
  assert.strictEqual(pet.state, "sleep");
  pet.nextIdle();
  assert.strictEqual(pet.state, "sleep"); // still nothing to collect

  pet.captured(1);
  assert.strictEqual(pet.state, "stretch");
  assert.strictEqual(pet.popups[0].text, "+1");
  pet.update(pet.stateEnd + 1, 16);
  assert.strictEqual(pet.state, "pounce");
});

test("scrolling makes it watch, but not while asleep", () => {
  const pet = fox();
  pet.setFlowers(waiting(1));
  pet.scrolling();
  assert.strictEqual(pet.state, "watch");
  pet.setState("sleep", 60000);
  pet.scrolling();
  assert.strictEqual(pet.state, "sleep");
});

test("with reduce animations on it only sits and blinks", () => {
  const pet = fox({ reduced: true });
  pet.setFlowers([]);
  pet.captured(1);
  pet.scrolling();
  for (let i = 0; i < 20; i += 1) pet.nextIdle();
  assert.strictEqual(pet.state, "sit");
  assert.strictEqual(pet.popups.length, 0);
});

test("the panel fox never walks, and the strip fox walks within the strip", () => {
  const panel = fox({ width: 340, panel: true });
  const strip = fox();
  panel.setFlowers(waiting(3));
  strip.setFlowers(waiting(3));
  const realRandom = Math.random;
  try {
    Math.random = () => 0.99; // never a nap: the "walk" branch where allowed
    for (let i = 0; i < 10; i += 1) {
      panel.nextIdle();
      assert.notStrictEqual(panel.state, "walk");
    }
    strip.nextIdle();
    assert.strictEqual(strip.state, "walk");
    let now = performance.now();
    for (let i = 0; i < 5000 && strip.state === "walk"; i += 1) {
      now += 16;
      strip.update(now, 16);
      assert.ok(strip.x >= 0 && strip.x <= 1200 - FOX_WIDTH);
    }
    assert.notStrictEqual(strip.state, "walk"); // it arrived and sat down
  } finally {
    Math.random = realRandom;
  }
});

test("after a while a bee visits a foxglove or two, then flies away", () => {
  const pet = fox();
  pet.setFlowers(waiting(5));
  let now = performance.now();
  pet.update(now, 16);
  assert.strictEqual(pet.bee, null); // not straight away
  now = pet.nextBeeAt + 1;
  pet.update(now, 16);
  assert.ok(pet.bee, "no bee after the wait");
  const visits = pet.bee.stops.length;
  assert.ok(visits >= 1 && visits <= 3);
  let hovered = 0;
  for (let i = 0; i < 20000 && pet.bee; i += 1) {
    now += 16;
    pet.update(now, 16);
    if (pet.bee && pet.bee.hoverUntil) hovered += 1;
  }
  assert.strictEqual(pet.bee, null, "the bee never left");
  assert.ok(hovered > 0, "the bee never stopped at a flower");
  assert.ok(pet.nextBeeAt > now, "no wait before the next bee");
});

test("no bee with an empty garden, in the panel, or with reduce animations on", () => {
  for (const pet of [fox(), fox({ width: 340, panel: true }), fox({ reduced: true })]) {
    pet.setFlowers(pet.panel || pet.reduced ? waiting(3) : []);
    pet.update(pet.nextBeeAt + 1, 16);
    assert.strictEqual(pet.bee, null);
  }
});

test("there is no hover state any more", () => {
  assert.strictEqual("hover" in fox(), false);
  assert.strictEqual(globalThis.PetSprites.FOX.peek, undefined);
});

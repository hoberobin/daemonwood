import test from "node:test";
import assert from "node:assert/strict";
import { AmbientLayer, FIRE } from "../src/effects.js";
import { BOAT, BOAT_BOB_MS, drawBoat, drawCreek, landmarkAt } from "../src/world-art.js";
import { WorldRenderer } from "../src/renderer.js";
import { ArtTimeline } from "../src/art-animation.js";
import { AgentController, nodes, stationPosition } from "../src/world-model.js";
import { ambient } from "../src/design/tokens.js";
import { FAMILIARS } from "../src/familiars.js";

/* A canvas that accepts anything and counts what it was asked to do. The
   renderer touches most of the 2D API; a stub that only knew the calls someone
   remembered to list would pass for code that throws in a real browser. */
function anyContext() {
  const counts = new Map();
  const gradient = { addColorStop() {} };
  const target = { canvas: { width: 1024, height: 576 } };
  return new Proxy(target, {
    get(object, name) {
      if (name === "counts") return counts;
      if (name in object) return object[name];
      if (name === "measureText") return () => ({ width: 10 });
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => gradient;
      return (...args) => { counts.set(name, (counts.get(name) || 0) + 1); return args[0]; };
    },
    set(object, name, value) { object[name] = value; return true; }
  });
}

test("the fire and the boat answer where the plate paints them", () => {
  assert.equal(landmarkAt({ x: FIRE.x, y: FIRE.y }), "fire");
  assert.equal(landmarkAt({ x: FIRE.x, y: FIRE.y - 12 }), "fire", "the flame's tip counts");
  assert.equal(landmarkAt({ x: BOAT.x, y: BOAT.y }), "boat");
  assert.equal(landmarkAt({ x: 60, y: 150 }), null, "open ground is open ground");
  assert.equal(landmarkAt(null), null);
});

test("no seat or station is a landmark, so a poke never competes with a familiar", () => {
  for (const node of Object.keys(nodes)) {
    const spots = node === "campfire" ? [0, 1, 2, 3].map((slot) => stationPosition(node, slot)) : [nodes[node]];
    for (const spot of spots) assert.equal(landmarkAt(spot), null, `${node} must stay clear of the fire and the boat`);
  }
});

test("stoking flares the fire, then it settles back on its own", () => {
  const fire = new AmbientLayer();
  assert.equal(fire.flare(1000), 0);
  fire.stoke(1000);
  assert.ok(fire.flare(1200) > 0.5, "a poke is seen at once");
  assert.ok(fire.flare(1200) > fire.flare(1000 + ambient.stokeMs * 0.6), "and fades");
  assert.equal(fire.flare(1000 + ambient.stokeMs), 0, "and is gone");
});

test("poking the fire quickly builds a bigger blaze, but only so big", () => {
  const fire = new AmbientLayer();
  fire.stoke(1000);
  const once = fire.flare(1200);
  for (let index = 0; index < 20; index += 1) fire.stoke(1000);
  assert.ok(fire.flare(1200) > once);
  assert.equal(fire.stokes.length, ambient.stokeLimit);
});

test("reduced motion flares the light and throws no sparks", () => {
  const view = { x: 0, y: 0, width: 1024, height: 576, scale: 2 };
  const arcs = (reducedMotion, stoked) => {
    const fire = new AmbientLayer({ reducedMotion });
    if (stoked) fire.stoke(1000);
    const context = anyContext();
    fire.draw(context, view, 1300);
    return context.counts.get("arc") || 0;
  };
  assert.ok(arcs(false, true) > arcs(false, false), "a stoke throws sparks");
  assert.equal(arcs(true, true), arcs(true, false), "not for a viewer who asked for less motion");
});

test("the boat is only redrawn while it is bobbing", () => {
  const view = { x: 0, y: 0, scale: 2 };
  const drawn = (age) => {
    const context = anyContext();
    drawBoat(context, {}, view, age, false);
    return context.counts.get("drawImage") || 0;
  };
  assert.equal(drawn(-Infinity), 0, "never knocked");
  assert.equal(drawn(400), 1);
  assert.equal(drawn(BOAT_BOB_MS), 0, "settled");
});

test("water accents move slowly and hold still for reduced motion", () => {
  const view = { x: 0, y: 0, scale: 2 };
  const frame = (time, reducedMotion) => {
    const marks = [];
    const context = {
      save() {}, restore() {}, beginPath() {}, stroke() {},
      ellipse(...args) { marks.push(["ring", ...args]); },
      fillRect(...args) { marks.push(["glint", ...args]); }
    };
    drawCreek(context, view, time, reducedMotion);
    return marks;
  };
  assert.deepEqual(frame(0, true), frame(30_000, true));
  assert.notDeepEqual(frame(0, false), frame(30_000, false));
  assert.equal(frame(0, false).filter(([kind]) => kind === "glint").length, 5);
});

/* The renderer's whole frame, on a fake canvas, with every mood on the map at
   once. A frame that throws stops the animation loop and leaves an empty
   world — which is exactly what a stray undefined name in the badge code did,
   with every other test in the suite passing. */
test("a whole frame draws without throwing, moods and all", () => {
  const context = anyContext();
  const image = { complete: true, naturalWidth: 512 };
  const renderer = Object.assign(Object.create(WorldRenderer.prototype), {
    canvas: { width: 1024, height: 576 }, context, scale: 2, offsetX: 0, offsetY: 0, pixelRatio: 1,
    coverRight: 0, reducedMotion: false, ambient: new AmbientLayer(), timeline: new ArtTimeline(),
    stationArt: { draw() {} }, map: image, helper: image, stationBases: [], boatKnockedAt: 0,
    sprites: new Map(FAMILIARS.map(({ type }) => [type, image]))
  });
  const now = Date.parse("2026-09-26T12:00:00.000Z");
  const record = (key, state, node, slot, since, extra = {}) => {
    const controller = new AgentController({ start: node, occupancySlot: slot, crowd: 2 });
    controller.state = state;
    controller.destination = node;
    Object.assign(controller, extra);
    return { key, agentName: key, familiarType: FAMILIARS[0].type, subagents: 1, trail: [], stateSince: since, controller };
  };
  const records = [
    record("sulking", "needs_input", "permission_gate", 0, now - 20 * 60_000),
    record("tapping", "needs_input", "permission_gate", 1, now - 7 * 60_000),
    record("resting-a", "idle", "campfire", 0, now - 5 * 60_000),
    record("resting-b", "idle", "campfire", 1, now - 5 * 60_000),
    record("working", "running", "command", 0, now)
  ];
  renderer.ambient.stoke(100);
  for (const elapsed of [120, 900, 5_050, 5_900]) {
    assert.doesNotThrow(() => renderer.draw(records, elapsed, "working", "tapping", now + elapsed));
  }
  assert.deepEqual(["resting-a", "resting-b"].map((key) => renderer.poses.get(key).behaviours), [["idle.company"], ["idle.company"]], "the two at the fire are keeping each other company");
});

/* Station sheets are optional art. With one loaded, a working familiar is
   drawn from it; with none — or one that failed to load — the same frame draws
   from the ordinary sheet and nothing throws. */
test("a station sheet is drawn from when it has loaded, and never needed", () => {
  const drawnFrom = (stationSprites) => {
    const images = [];
    const context = anyContext();
    const drawImage = (...args) => { images.push(args[0]); };
    const proxy = new Proxy(context, { get: (target, name) => name === "drawImage" ? drawImage : target[name] });
    const image = { complete: true, naturalWidth: 512, id: "plain" };
    const renderer = Object.assign(Object.create(WorldRenderer.prototype), {
      canvas: { width: 1024, height: 576 }, context: proxy, scale: 2, offsetX: 0, offsetY: 0, pixelRatio: 1,
      coverRight: 0, reducedMotion: false, ambient: new AmbientLayer(), timeline: new ArtTimeline(),
      stationArt: { draw() {} }, map: image, helper: image, stationBases: [], boatKnockedAt: 0,
      sprites: new Map(FAMILIARS.map(({ type }) => [type, { complete: true, naturalWidth: 512, id: `sprite-${type}` }])),
      stationSprites
    });
    const controller = new AgentController({ start: "workbench" });
    controller.state = "editing";
    controller.destination = "workbench";
    const record = { key: "k", agentName: "k", familiarType: "moss", subagents: 0, trail: [], stateSince: Date.now(), controller };
    for (const elapsed of [0, 400, 2100]) assert.doesNotThrow(() => renderer.draw([record], elapsed, null, null, Date.now()));
    return new Set(images.map((drawn) => drawn?.id));
  };
  const sheet = { complete: true, naturalWidth: 512, id: "moss-stations" };
  assert.ok(drawnFrom(new Map([["moss", sheet]])).has("moss-stations"), "the loaded sheet is used");
  assert.ok(!drawnFrom(new Map([["moss", sheet]])).has("sprite-moss"), "and the plain sheet is not, while working");
  assert.ok(drawnFrom(new Map()).has("sprite-moss"), "no sheet: the ordinary frames");
  assert.ok(drawnFrom(undefined).has("sprite-moss"), "no map at all: the ordinary frames");
});

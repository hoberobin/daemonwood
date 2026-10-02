import test from "node:test";
import assert from "node:assert/strict";
import { AmbientLayer, FIRE, LANTERNS, withAlpha } from "../src/effects.js";
import { ambient } from "../src/design/tokens.js";

/* A canvas stand-in that records what was asked of it AND models the save/
   restore stack for the properties that can leak. A stub that lets state leak
   silently would report a clean run for code that tints every familiar on the
   map, which is the one failure this test exists to catch. */
function stubContext() {
  const calls = [];
  const stack = [];
  const record = (name) => (...args) => { calls.push({ name, args }); };
  const gradient = { addColorStop: record("addColorStop") };
  const tracked = ["globalCompositeOperation", "globalAlpha", "fillStyle", "strokeStyle"];
  const context = {
    calls,
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: null,
    strokeStyle: null,
    save(...args) {
      calls.push({ name: "save", args });
      stack.push(Object.fromEntries(tracked.map((key) => [key, context[key]])));
    },
    restore(...args) {
      calls.push({ name: "restore", args });
      const previous = stack.pop();
      if (previous) Object.assign(context, previous);
    },
    translate: record("translate"),
    scale: record("scale"),
    beginPath: record("beginPath"),
    arc: record("arc"),
    fill: record("fill"),
    fillRect: record("fillRect"),
    createLinearGradient: (...args) => { calls.push({ name: "createLinearGradient", args }); return gradient; },
    createRadialGradient: (...args) => { calls.push({ name: "createRadialGradient", args }); return gradient; }
  };
  return context;
}

const view = { x: 0, y: 0, width: 1024, height: 576, scale: 2 };

test("alpha is applied to a token colour without inventing a new one", () => {
  assert.equal(withAlpha("#f4cb43", 0.5), "rgba(244, 203, 67, 0.5)");
  assert.equal(withAlpha("#fff", 1), "rgba(255, 255, 255, 1)");
  assert.equal(withAlpha("rgba(10, 20, 30, 0.8)", 0.25), "rgba(10, 20, 30, 0.25)");
  // Out-of-range alpha is clamped rather than emitted as invalid CSS.
  assert.equal(withAlpha("#000000", 2), "rgba(0, 0, 0, 1)");
  assert.equal(withAlpha("#000000", -1), "rgba(0, 0, 0, 0)");
});

test("the world looks the same on every reload", () => {
  const first = new AmbientLayer();
  const second = new AmbientLayer();
  assert.deepEqual(first.embers, second.embers, "embers must not be randomised between loads");
  assert.equal(first.embers.length, ambient.emberCount);
});

test("asking for less motion freezes the fire without putting it out", () => {
  const still = new AmbientLayer({ reducedMotion: true });
  assert.equal(still.phase(0), still.phase(60_000), "time must not advance for a viewer who asked it not to");

  const moving = new AmbientLayer({ reducedMotion: false });
  assert.notEqual(moving.phase(0), moving.phase(60_000));

  // Still lit, just not flickering: the light is the point, the motion is not.
  const context = stubContext();
  still.draw(context, view, 30_000);
  assert.ok(context.calls.some((call) => call.name === "createRadialGradient"), "the firelight must still be drawn");
});

test("painted lanterns keep their light while reduced motion freezes their pulse", () => {
  assert.equal(LANTERNS.length, 6);
  const still = new AmbientLayer({ reducedMotion: true });
  const first = stubContext(), later = stubContext();
  still.draw(first, view, 0);
  still.draw(later, view, 30_000);
  assert.deepEqual(first.calls, later.calls);
  assert.equal(first.calls.filter((call) => call.name === "createRadialGradient").length, 2 + LANTERNS.length);
});

test("firelight drawing is balanced and never leaks canvas state", () => {
  const context = stubContext();
  const layer = new AmbientLayer();
  layer.draw(context, view, 4_200);
  const saves = context.calls.filter((call) => call.name === "save").length;
  const restores = context.calls.filter((call) => call.name === "restore").length;
  assert.equal(saves, restores, "every save must be restored or the familiars inherit ambient state");
  assert.equal(context.globalCompositeOperation, "source-over", "composite mode must be handed back as it was found");
});

test("the fire is lit where the plate actually painted it", () => {
  // Measured against assets/map/workshop-plate-v3.png. If the plate moves, this moves.
  assert.ok(FIRE.x > 240 && FIRE.x < 275, "fire should sit in the central clearing");
  assert.ok(FIRE.y > 115 && FIRE.y < 150, "fire should sit at the campfire, not at the standing spot below it");
});

/* The rule that lets atmosphere exist at all: it is drawn between the plate and
   everyone standing on it. If ambient drawing ever moves after the familiars,
   weather starts tinting the thing the user is trying to read. */
test("weather is drawn under the familiars, never over them", async () => {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const source = await readFile(join(root, "src/renderer.js"), "utf8");

  const body = source.slice(source.indexOf("  draw(records"), source.indexOf("  drawStationLabels("));
  const ambientAt = body.indexOf("this.ambient.draw(");
  const placardsAt = body.indexOf("this.drawStationLabels(");
  const agentsAt = body.indexOf("this.drawAgent(");

  assert.ok(ambientAt > 0, "the ambient layer must be drawn");
  assert.ok(ambientAt < placardsAt, "firelight must be drawn before the station placards");
  assert.ok(placardsAt < agentsAt, "placards must be drawn before the familiars");
});

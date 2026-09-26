import test from "node:test";
import assert from "node:assert/strict";
import { animationFrame, ArtTimeline, helperCount, CLIPS } from "../src/art-animation.js";
import { occupiedStations } from "../src/world-art.js";
import { MAP_FAMILIAR_LIMIT, stationPosition } from "../src/world-model.js";
import { encodePNG, decodePNG, blit } from "../scripts/lib/png.mjs";

test("each direction plays four authored walk frames with no state mutation", () => {
  for (const direction of ["down", "left", "right", "up"]) {
    const agent = Object.freeze({ moving: true, direction, state: "editing" });
    assert.deepEqual([0, 145, 290, 435].map((t) => animationFrame(agent, t).frame), CLIPS[`walk:${direction}`]);
    assert.equal(animationFrame(agent, 580).frame, CLIPS[`walk:${direction}`][0]);
  }
});
test("all character clips freeze under reduced motion", () => {
  for (const state of ["idle", "needs_input", "trouble", "finished"]) for (const moving of [false, true]) {
    const agent = { state, moving, direction: "left" };
    const frame = (t) => animationFrame(agent, t, { reducedMotion: true, phase: 99, stateAge: t });
    assert.deepEqual(frame(0), frame(3900));
  }
});
test("idle blinks rarely; finished acknowledgement settles after three seconds", () => {
  assert.equal(animationFrame({ state: "idle" }, 5000).frame, 16);
  assert.equal(animationFrame({ state: "idle" }, 7150).frame, 17);
  assert.equal(animationFrame({ state: "finished" }, 700, { stateAge: 700 }).frame, 23);
  assert.equal(animationFrame({ state: "finished" }, 3700, { stateAge: 3700 }).frame, 22);
});
test("timeline changes only when visual state changes and prunes removed sessions", () => {
  const timeline = new ArtTimeline(), record = { key: "a", controller: { state: "finished" }, subagents: 5 };
  timeline.update([record], 100); timeline.update([record], 2100);
  assert.equal(timeline.get("a", 2100).age, 2000);
  record.controller.state = "editing"; record.subagents = 0;
  timeline.update([record], 2200);
  assert.equal(timeline.get("a", 2200).age, 0);
  assert.equal(timeline.get("a", 2200).previousHelpers, 3);
  timeline.update([], 2300); assert.equal(timeline.records.size, 0);
});
test("helpers cap at three while preserving overflow, including malformed counts", () => {
  assert.deepEqual(helperCount(7), { visible: 3, overflow: 4 });
  for (const bad of [-1, NaN, Infinity, "oops"]) assert.deepEqual(helperCount(bad), { visible: 0, overflow: 0 });
});
test("station effects require a present stationary parent", () => {
  const parked = { key: "a", controller: { currentNode: "command", destination: "command" } };
  const moving = { controller: { ...parked.controller, moving: true } };
  const leaving = { controller: { ...parked.controller, leaving: true } };
  const enRoute = { controller: { currentNode: "research", destination: "command" } };
  assert.deepEqual(occupiedStations([parked, moving, leaving, enRoute]).get("command"), [parked]);
});
test("a crowd of southern occupants stays on the dock and inside the gate", () => {
  for (const station of ["shipping_dock", "permission_gate"]) {
    for (let crowd = 4; crowd <= MAP_FAMILIAR_LIMIT; crowd += 1) {
      const seats = [...Array(crowd).keys()].map((slot) => stationPosition(station, slot, crowd));
      assert.equal(new Set(seats.map(({ x, y }) => `${x},${y}`)).size, crowd);
      assert.ok(seats.every(({ y }) => y <= 229));
    }
  }
});
test("PNG export roundtrips exactly and downsamples premultiplied alpha", () => {
  const source = { width: 2, height: 1, data: Buffer.from([255, 0, 0, 255, 0, 0, 255, 0]) };
  assert.deepEqual(decodePNG(encodePNG(source)), source);
  const out = { width: 1, height: 1, data: Buffer.alloc(4) };
  blit(source, [0, 0, 2, 1], out, 0, 0, 1, 1);
  assert.deepEqual([...out.data], [255, 0, 0, 128]);
});

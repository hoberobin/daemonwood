import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPATIENCE,
  campfireCompany, companyFrame, impatience, impatiencePose, waitLabel, waitedMs
} from "../src/familiar-moods.js";
import { AgentController, nodes, stationPosition } from "../src/world-model.js";
import { AgentRegistry } from "../src/agent-registry.js";
import { IDLE_AFTER_MS } from "../src/state-machine.js";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const minutes = (count) => count * 60_000;

function asking(waited, extra = {}) {
  return { key: "k", stateSince: NOW - waited, controller: { state: "needs_input", leaving: false, ...extra } };
}

test("impatience grows only while a session is waiting on you", () => {
  assert.equal(impatience(asking(minutes(0.5)), NOW).name, "calm");
  assert.equal(impatience(asking(minutes(2)), NOW).name, "glancing");
  assert.equal(impatience(asking(minutes(7)), NOW).name, "tapping");
  assert.equal(impatience(asking(minutes(20)), NOW).name, "sulking");
  assert.deepEqual(IMPATIENCE.map((step) => step.level), [0, 1, 2, 3]);

  // Working, resting or walking out: nobody is waiting, so nobody is impatient.
  assert.equal(waitedMs({ ...asking(minutes(20)), controller: { state: "running" } }, NOW), 0);
  assert.equal(waitedMs(asking(minutes(20), { leaving: true }), NOW), 0);
  assert.equal(impatience({ controller: { state: "idle" } }, NOW).level, 0);
});

test("waiting falls back to the trail when a record has no stamp", () => {
  const record = { controller: { state: "needs_input" }, trail: [{ at: new Date(NOW - minutes(6)).toISOString(), state: "needs_input" }] };
  assert.equal(impatience(record, NOW).name, "tapping");
});

test("the wait reads as a short clock, and not at all under a minute", () => {
  assert.equal(waitLabel(minutes(0.9)), "");
  assert.equal(waitLabel(minutes(7)), "7m");
  assert.equal(waitLabel(minutes(60)), "1h");
  assert.equal(waitLabel(minutes(65)), "1h 5m");
  assert.equal(waitLabel(undefined), "");
});

test("impatient postures escalate and never lift a familiar off its spot", () => {
  const over = (level, options = {}) => Array.from({ length: 600 }, (_, index) => impatiencePose(level, index * 20, options));

  assert.ok(over(0).every((pose) => pose.frame === null && pose.lift === 0), "a fresh request is just a familiar asking");
  assert.ok(over(1).some((pose) => pose.lift > 0), "glancing hops now and then");
  assert.ok(over(1).filter((pose) => pose.lift > 0).length < 60, "but mostly stands still");
  assert.ok(over(2).some((pose) => pose.tap), "tapping puts a foot down");
  for (const level of [1, 2, 3]) assert.ok(over(level).every((pose) => pose.lift <= 3), "a hop is small");

  const sulk = over(3);
  assert.ok(sulk.filter((pose) => pose.frame === 13).length > sulk.length * 0.7, "sulking is a turned back");
  assert.ok(sulk.some((pose) => pose.frame === 18), "which turns round to show the request again");
});

test("reduced motion keeps the postures and drops the movement", () => {
  for (const level of [1, 2]) {
    for (let elapsed = 0; elapsed < 12_000; elapsed += 20) {
      const pose = impatiencePose(level, elapsed, { reducedMotion: true });
      assert.equal(pose.lift, 0);
      assert.equal(pose.tap, false);
    }
  }
  for (let elapsed = 0; elapsed < 12_000; elapsed += 20) {
    assert.equal(impatiencePose(3, elapsed, { reducedMotion: true }).frame, 13, "a turned back holds still, no glances");
  }
});

function resting(key, slot, since, overrides = {}) {
  const controller = new AgentController({ start: "campfire", occupancySlot: slot, crowd: 2 });
  controller.state = "idle";
  controller.destination = "campfire";
  Object.assign(controller, overrides);
  return { key, stateSince: since, controller };
}

test("a familiar resting alone keeps its own company", () => {
  assert.equal(campfireCompany([resting("a", 0, NOW)]).size, 0);
});

test("two resting at the fire face it, and each other", () => {
  const company = campfireCompany([resting("a", 0, NOW - 1000), resting("b", 1, NOW - 2000)]);
  assert.equal(company.size, 2);
  assert.ok(stationPosition("campfire", 0).x < nodes.campfire.x, "slot 0 sits west of the fire");
  assert.equal(company.get("a").facing, "right");
  assert.equal(company.get("b").facing, "left");
  assert.notEqual(companyFrame("left"), companyFrame("right"));
});

test("only familiars settled at the fire count as company", () => {
  const walking = resting("b", 1, NOW, { moving: true });
  const leaving = resting("c", 1, NOW, { leaving: true });
  const working = resting("d", 1, NOW, { state: "running" });
  for (const other of [walking, leaving, working]) {
    assert.equal(campfireCompany([resting("a", 0, NOW), other]).size, 0);
  }
});

test("a third familiar joining does not restart the first two's company", () => {
  const first = resting("a", 0, NOW - minutes(10));
  const second = resting("b", 1, NOW - minutes(8));
  const before = campfireCompany([first, second]);
  const after = campfireCompany([first, second, resting("c", 2, NOW)]);
  assert.equal(after.get("a").since, before.get("a").since);
  assert.equal(after.get("b").since, before.get("b").since);
  assert.equal(after.get("a").since, NOW - minutes(8), "company began when the second one sat down");
  assert.equal(after.get("c").since, NOW, "the newcomer's company begins when it arrives");
});

test("the registry stamps when each state began, on the wall clock", () => {
  const registry = new AgentRegistry();
  const at = (offset) => new Date(NOW + offset).toISOString();
  registry.apply({ sessionId: "s", visualState: "running", timestamp: at(0) });
  assert.equal(registry.records.get("s").stateSince, NOW);

  registry.apply({ sessionId: "s", visualState: "needs_input", timestamp: at(5000) });
  assert.equal(registry.records.get("s").stateSince, NOW + 5000);
  // Another event in the same state is the same wait, not a new one.
  registry.apply({ sessionId: "s", visualState: "needs_input", timestamp: at(9000) });
  assert.equal(registry.records.get("s").stateSince, NOW + 5000);

  // Idle begins when the quiet ran out, not when the clock noticed — so a
  // reload does not restart the campfire's company.
  registry.apply({ sessionId: "s", visualState: "finished", timestamp: at(10_000) });
  registry.settle(NOW + 10_000 + IDLE_AFTER_MS + minutes(3));
  assert.equal(registry.records.get("s").controller.state, "idle");
  assert.equal(registry.records.get("s").stateSince, NOW + 10_000 + IDLE_AFTER_MS);
});

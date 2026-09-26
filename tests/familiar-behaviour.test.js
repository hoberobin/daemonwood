import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BEHAVIOURS, EMPTY_POSE, FAMILIAR_POSES, FLOURISH_BUDGET, POSES, RESERVED_POSES,
  flourishActive, poseFrame, resolvePoses
} from "../src/familiar-behaviour.js";
import { campfireCompany, companyFrame, impatience, impatiencePose } from "../src/familiar-moods.js";
import { AgentController, destinationByState, nodes } from "../src/world-model.js";
import { IDLE_AFTER_MS, VISUAL_STATES } from "../src/state-machine.js";
import { STATION_CLIPS, STATION_FRAME_BASE, stablePhase } from "../src/art-animation.js";
import { FAMILIARS, TEMPERAMENTS, TEMPO_RANGE, temperament } from "../src/familiars.js";

/* These tests hold every row of the behaviour table to the same rules, so a
   new behaviour is checked the moment it is added — nobody has to remember to
   write the test that would have caught it. */

const NOW = Date.parse("2026-09-26T12:00:00.000Z");
const M = 60_000;
const STATES = Object.values(VISUAL_STATES);

function familiarAt(key, state, { slot = 0, crowd = 1, since = NOW, quietSince = since, type = "moss", ...extra } = {}) {
  const node = destinationByState[state];
  const controller = new AgentController({ start: node, occupancySlot: slot, crowd });
  controller.state = state;
  controller.destination = node;
  Object.assign(controller, extra);
  return { key, familiarType: type, stateSince: since, lastEventAt: new Date(quietSince).toISOString(), trail: [], controller };
}

/* A spread of maps: every state alone and in pairs, at ages from just now to
   an hour, so each behaviour meets the moments it is written for. */
function scenes() {
  const out = [];
  for (const state of STATES) {
    for (const age of [0, 1000, 2000, 30_000, 2.5 * M, 4.5 * M, 12 * M, 60 * M]) {
      out.push([familiarAt(`${state}-solo`, state, { since: NOW - age, type: "spruce" })]);
      out.push([
        familiarAt(`${state}-a`, state, { slot: 0, crowd: 2, since: NOW - age, type: "ripple" }),
        familiarAt(`${state}-b`, state, { slot: 1, crowd: 2, since: NOW - age - 30_000, type: "mica" })
      ]);
    }
  }
  return out;
}
const TIMES = Array.from({ length: 160 }, (_, index) => index * 97);
// As if every familiar's station sheet had loaded, so the rules below also
// hold for the station poses the day the art arrives.
const ALL_SHEETS = new Set(FAMILIARS.map(({ type }) => type));

function* everyPose(options = {}) {
  for (const records of scenes()) {
    for (const elapsed of TIMES) {
      const poses = resolvePoses(records, { now: NOW + elapsed, elapsed, ...options });
      for (const record of records) yield { record, pose: poses.get(record.key), elapsed };
    }
  }
}

test("every behaviour is a well-formed, documented row", () => {
  const ids = BEHAVIOURS.map((behaviour) => behaviour.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  const guide = readFileSync(new URL("../docs/design-system.md", import.meta.url), "utf8");
  for (const behaviour of BEHAVIOURS) {
    assert.match(behaviour.id, /^[a-z_]+\.[a-z_]+$/, `${behaviour.id} is state.name`);
    assert.ok(behaviour.summary?.length > 20, `${behaviour.id} says what it does`);
    assert.ok(Number.isFinite(behaviour.priority), `${behaviour.id} has a priority`);
    assert.ok(behaviour.states.length > 0, `${behaviour.id} belongs to at least one state`);
    for (const state of behaviour.states) assert.ok(STATES.includes(state), `${behaviour.id}: ${state} is a real state`);
    assert.ok(guide.includes(`\`${behaviour.id}\``), `${behaviour.id} is listed in docs/design-system.md`);
  }
});

test("reserved poses belong to their state alone", () => {
  for (const { record, pose } of [...everyPose(), ...everyPose({ stationSheets: ALL_SHEETS })]) {
    for (const [name, owner] of Object.entries(RESERVED_POSES)) {
      if (pose.frame === POSES[name]) assert.equal(record.controller.state, owner, `${name} shown by a ${record.controller.state} familiar`);
    }
  }
});

test("a behaviour never touches the record it reads", () => {
  const freeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const inner of Object.values(value)) freeze(inner);
    }
    return value;
  };
  for (const records of scenes()) {
    const before = JSON.stringify(records);
    freeze(records);
    for (const elapsed of [0, 900, 5100, 12_000]) {
      assert.doesNotThrow(() => resolvePoses(records, { now: NOW + elapsed, elapsed }));
    }
    assert.equal(JSON.stringify(records), before);
  }
});

test("the same moment always gives the same pose", () => {
  for (const records of scenes().slice(0, 40)) {
    for (const elapsed of [0, 1234, 9999]) {
      const first = resolvePoses(records, { now: NOW + elapsed, elapsed });
      const second = resolvePoses(records, { now: NOW + elapsed, elapsed });
      assert.deepEqual([...first], [...second]);
    }
  }
});

test("reduced motion holds postures and drops every movement", () => {
  const flourishes = new Set(BEHAVIOURS.filter((behaviour) => behaviour.flourish).map((behaviour) => behaviour.id));
  for (const { pose } of [...everyPose({ reducedMotion: true }), ...everyPose({ reducedMotion: true, stationSheets: ALL_SHEETS })]) {
    assert.equal(pose.lift, 0);
    assert.equal(pose.tap, false);
    for (const id of pose.behaviours) assert.ok(!flourishes.has(id), `${id} is a flourish and ran under reduced motion`);
  }
});

test("a pose is small: the badge stays on the head and the frame is a real one", () => {
  const frames = new Set(Object.values(POSES));
  for (const { pose } of [...everyPose(), ...everyPose({ stationSheets: ALL_SHEETS })]) {
    assert.ok(pose.lift >= 0 && pose.lift <= 3, `lift ${pose.lift}`);
    assert.ok(pose.frame === null || frames.has(pose.frame), `frame ${pose.frame}`);
  }
});

test("walking is walking, and leaving is leaving", () => {
  for (const state of STATES) {
    const moving = familiarAt("m", state, { since: NOW - 20 * M, moving: true, direction: "left" });
    const leaving = familiarAt("l", state, { since: NOW - 20 * M, leaving: { at: NOW } });
    const poses = resolvePoses([moving, leaving], { now: NOW, elapsed: 5050 });
    assert.equal(poses.get("m"), EMPTY_POSE);
    assert.equal(poses.get("l"), EMPTY_POSE);
  }
});

test("flourishes are brief and rare, even for the brisk", () => {
  const brisk = { phase: 0, tempo: TEMPO_RANGE.min };
  for (const behaviour of BEHAVIOURS.filter((candidate) => candidate.flourish && !candidate.flourish.oneShot)) {
    const { everyMs, lastsMs } = behaviour.flourish;
    assert.ok(everyMs * TEMPO_RANGE.min >= FLOURISH_BUDGET.minEveryMs, `${behaviour.id} comes round too often`);
    let active = 0, samples = 0;
    for (let elapsed = 0; elapsed < 10 * M; elapsed += 50, samples += 1) if (flourishActive({ ...brisk, elapsed }, behaviour.flourish)) active += 1;
    assert.ok(active / samples <= FLOURISH_BUDGET.maxShare, `${behaviour.id} is active ${(active / samples * 100).toFixed(1)}% of the time`);
    assert.ok(lastsMs <= 2000, `${behaviour.id} lasts ${lastsMs}ms`);
  }
});

test("impatience and company draw exactly what they did before the table", () => {
  for (const waited of [0, 2 * M, 7 * M, 20 * M]) {
    const record = familiarAt("w", "needs_input", { since: NOW - waited });
    const phase = stablePhase("w");
    for (const reducedMotion of [false, true]) {
      for (const elapsed of TIMES) {
        const expected = impatiencePose(impatience(record, NOW).level, elapsed, { phase, reducedMotion });
        const pose = resolvePoses([record], { now: NOW, elapsed, reducedMotion }).get("w");
        assert.equal(pose.frame, expected.frame);
        assert.equal(pose.lift, expected.lift);
        assert.equal(pose.tap, expected.tap);
      }
    }
  }
  const pair = [familiarAt("a", "idle", { slot: 0, crowd: 2 }), familiarAt("b", "idle", { slot: 1, crowd: 2 })];
  const company = campfireCompany(pair);
  const poses = resolvePoses(pair, { now: NOW, elapsed: 0 });
  for (const key of ["a", "b"]) assert.equal(poses.get(key).frame, companyFrame(company.get(key).facing));
});

test("idle familiars briefly watch the fire without interrupting company", () => {
  const solo = familiarAt("solo", "idle");
  const pair = [familiarAt("left", "idle", { slot: 0, crowd: 2 }), familiarAt("right", "idle", { slot: 1, crowd: 2 })];
  const soloFrames = new Set();
  let breathingTogether = false;
  for (let elapsed = 0; elapsed < 30_000; elapsed += 50) {
    soloFrames.add(resolvePoses([solo], { now: NOW, elapsed }).get("solo").frame);
    const poses = resolvePoses(pair, { now: NOW, elapsed });
    if (poses.get("left").lift > 0 || poses.get("right").lift > 0) breathingTogether = true;
    assert.equal(poses.get("left").frame, POSES.face_right);
    assert.equal(poses.get("right").frame, POSES.face_left);
  }
  assert.deepEqual(soloFrames, new Set([null, POSES.face_right]));
  assert.ok(breathingTogether, "company has a small visible breath");
  assert.equal(resolvePoses([solo], { now: NOW, elapsed: 0, reducedMotion: true }).get("solo").frame, null);
});

test("a newcomer looks round once, and only when it has just arrived", () => {
  const seen = (age) => new Set(TIMES.map((elapsed) =>
    resolvePoses([familiarAt("n", "arriving", { since: NOW - age })], { now: NOW + elapsed, elapsed }).get("n").frame));
  assert.deepEqual(seen(0), new Set([null, POSES.face_left, POSES.face_right]));
  assert.deepEqual(seen(10_000), new Set([null]), "a reload later does not replay the arrival");
});

test("stationmates glance at each other, and only at someone really there", () => {
  const pair = [familiarAt("a", "editing", { slot: 0, crowd: 2 }), familiarAt("b", "editing", { slot: 1, crowd: 2 })];
  const [left, right] = [...pair].sort((x, y) => x.controller.position.x - y.controller.position.x);
  const frames = { [left.key]: new Set(), [right.key]: new Set() };
  for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
    const poses = resolvePoses(pair, { now: NOW, elapsed });
    for (const record of pair) frames[record.key].add(poses.get(record.key).frame);
  }
  assert.deepEqual(frames[left.key], new Set([null, POSES.face_right]), "the one on the left looks right");
  assert.deepEqual(frames[right.key], new Set([null, POSES.face_left]), "the one on the right looks left");

  const alone = familiarAt("solo", "editing");
  const walkingPast = familiarAt("w", "editing", { slot: 1, crowd: 2, moving: true });
  for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
    assert.equal(resolvePoses([alone, walkingPast], { now: NOW, elapsed }).get("solo").frame, null);
  }
});

test("a quiet DONE glances toward the fire only in its last minute", () => {
  const glances = (quiet) => TIMES.concat(TIMES.map((t) => t + 20_000)).some((elapsed) =>
    resolvePoses([familiarAt("d", "finished", { since: NOW - quiet, quietSince: NOW - quiet })], { now: NOW, elapsed }).get("d").frame !== null);
  assert.equal(glances(30_000), false);
  assert.equal(glances(3 * M), false);
  assert.equal(glances(IDLE_AFTER_MS - 30_000), true);
  const record = familiarAt("d", "finished");
  assert.ok(record.controller.position.x > nodes.campfire.x, "the dock is east of the fire, so the glance is west");
});

test("trouble frets only once it has been left a while", () => {
  const hops = (age) => TIMES.concat(TIMES.map((t) => t + 20_000)).some((elapsed) =>
    resolvePoses([familiarAt("t", "trouble", { since: NOW - age })], { now: NOW, elapsed }).get("t").lift > 0);
  assert.equal(hops(30_000), false);
  assert.equal(hops(3 * M), true);
});

test("every familiar has a temperament, and it only changes cadence", () => {
  for (const { type } of FAMILIARS) {
    const { tempo } = temperament(type);
    assert.ok(TEMPERAMENTS[type], `${type} has a temperament`);
    assert.ok(tempo >= TEMPO_RANGE.min && tempo <= TEMPO_RANGE.max, `${type} tempo ${tempo}`);
  }
  assert.equal(temperament("nobody").tempo, 1);
  // A waiting familiar escalates on the same clock whoever it is.
  for (const { type } of FAMILIARS) {
    const record = { ...familiarAt("w", "needs_input", { since: NOW - 7 * M }), familiarType: type };
    assert.equal(impatience(record, NOW).name, "tapping");
  }
});

test("poses resolve by name, with a per-familiar override and a shared fallback", () => {
  assert.equal(poseFrame("face_left", "moss"), POSES.face_left);
  assert.equal(poseFrame("nonsense", "moss"), null);
  assert.equal(poseFrame(undefined, "moss"), null);
  for (const [type, poses] of Object.entries(FAMILIAR_POSES)) {
    assert.ok(FAMILIARS.some((familiar) => familiar.type === type), `${type} is a familiar`);
    for (const [name, frame] of Object.entries(poses)) {
      assert.ok(name in POSES, `${type} overrides a known pose`);
      assert.ok(Number.isInteger(frame) && frame >= 0, `${type}.${name} is a frame`);
    }
  }
});

/* Station work. Nothing here changes a familiar without a station sheet: the
   renderer golden check proved that draw for draw, and the first test below
   holds it as a rule. */
const TOOLS = { editing: ["hammer_up", "hammer_down"], investigating: ["book_read", "book_turn"], running: ["lever_ready", "lever_pull"], testing: ["flask_hold", "flask_swirl"] };
const framesOver = (records, key, options = {}) => {
  const seen = [];
  for (let elapsed = 0; elapsed < 60_000; elapsed += 50) seen.push(resolvePoses(records, { now: NOW, elapsed, ...options }).get(key).frame);
  return seen;
};

test("without a station sheet, no station pose is ever asked for", () => {
  for (const { pose } of everyPose()) assert.ok(pose.frame === null || pose.frame < STATION_FRAME_BASE);
  for (const { pose } of everyPose({ stationSheets: new Set(["someone-else"]) })) assert.ok(pose.frame === null || pose.frame < STATION_FRAME_BASE);
});

test("the station frames are the contract's, in order", () => {
  for (const [state, [hold, strike]] of Object.entries(TOOLS)) {
    assert.equal(POSES[hold], STATION_FRAME_BASE + STATION_CLIPS[state][0]);
    assert.equal(POSES[strike], STATION_FRAME_BASE + STATION_CLIPS[state][1]);
  }
});

test("each station's familiar works with that station's tool, in a beat and a rest", () => {
  for (const [state, [hold, strike]] of Object.entries(TOOLS)) {
    const record = familiarAt("w", state, { type: "moss" });
    const seen = framesOver([record], "w", { stationSheets: new Set(["moss"]) });
    assert.deepEqual(new Set(seen), new Set([POSES[hold], POSES[strike]]), `${state} uses ${hold}/${strike} and nothing else`);
    const share = seen.filter((frame) => frame === POSES[strike]).length / seen.length;
    assert.ok(share > 0.02 && share < 0.3, `${state} strikes ${(share * 100).toFixed(0)}% of the time: mostly a held tool`);
    const still = framesOver([record], "w", { stationSheets: new Set(["moss"]), reducedMotion: true });
    assert.deepEqual(new Set(still), new Set([POSES[hold]]), `${state} holds the tool still under reduced motion`);
  }
});

test("no tool for states without one, or away from its own station", () => {
  const sheets = new Set(["moss"]);
  for (const state of ["preparing", "arriving", "trouble", "needs_input", "finished", "idle"]) {
    const seen = framesOver([familiarAt("x", state, { type: "moss", since: NOW - 3 * M })], "x", { stationSheets: sheets });
    assert.ok(seen.every((frame) => frame === null || frame < STATION_FRAME_BASE), `${state} has no station tool`);
  }
  const stray = familiarAt("s", "editing", { type: "moss" });
  stray.controller.currentNode = "research";
  assert.ok(framesOver([stray], "s", { stationSheets: sheets }).every((frame) => frame === null));
});

test("a familiar with its tool keeps it: no glance takes it out of its paws", () => {
  const pair = [familiarAt("a", "editing", { slot: 0, crowd: 2, type: "moss" }), familiarAt("b", "editing", { slot: 1, crowd: 2, type: "fern" })];
  const sheets = new Set(["moss"]);
  assert.ok(framesOver(pair, "a", { stationSheets: sheets }).every((frame) => frame === POSES.hammer_up || frame === POSES.hammer_down), "moss keeps its hammer");
  const fern = new Set(framesOver(pair, "b", { stationSheets: sheets }));
  assert.ok(fern.has(null) && [...fern].every((frame) => frame === null || frame === POSES.face_left || frame === POSES.face_right), "fern, with no sheet, still glances");
});

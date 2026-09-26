import test from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, FAMILIARS, FAREWELL_MAX_MS } from "../src/agent-registry.js";
import { IDLE_AFTER_MS } from "../src/state-machine.js";
import { EXIT_NODE, MAP_FAMILIAR_LIMIT, nodes, stationPosition } from "../src/world-model.js";

// `visible` is ordered by what deserves a place, not by arrival, so tests that
// care about one session look it up instead of trusting an index.
/* The invariant that actually matters: whatever the seating maths, no two
   familiars may be sent to the same spot. Their drawn positions converge on
   these only after walking, so the target is what the registry can promise. */
const assertNoOverlap = (registry) => {
  const spots = registry.visible.map((record) => {
    const { destination, occupancySlot, crowd } = record.controller;
    const { x, y } = stationPosition(destination, occupancySlot, crowd);
    return `${Math.round(x)},${Math.round(y)}`;
  });
  assert.equal(new Set(spots).size, spots.length, "two familiars are headed for the same spot");
};

const find = (registry, sessionId) => [...registry.records.values()].find((record) => record.sessionId === sessionId);

const event = (sessionId, label, visualState = "editing") => ({
  sessionId, agentName: label, repository: `${label}-repo`, taskLabel: "Test task",
  visualState, requiresAttention: visualState === "needs_input", subagentDelta: 0, timestamp: new Date().toISOString()
});

test("assigns four sessions to four distinct occupancy slots", () => {
  const registry = new AgentRegistry();
  for (const id of ["a", "b", "c", "d"]) registry.apply(event(id, `session-${id}`));
  assert.equal(registry.visible.length, 4);
  // Four at one station means four distinct spots around it.
  assert.deepEqual(registry.visible.map((record) => record.controller.occupancySlot).sort(), [0, 1, 2, 3]);
  assertNoOverlap(registry);
  assert.ok(registry.visible.every((record) => record.controller.destination === "workbench"));
  assert.equal(new Set(registry.visible.map((record) => record.familiarType)).size, 4);
});

test("a full map seats every familiar on its own spot, at every station", () => {
  const registry = new AgentRegistry();
  assert.equal(registry.maxVisible, MAP_FAMILIAR_LIMIT);
  assert.ok(MAP_FAMILIAR_LIMIT <= FAMILIARS.length, "the map cannot draw more faces than the family has");
  for (const state of ["editing", "investigating", "running", "testing", "needs_input", "finished", "idle"]) {
    const crowd = new AgentRegistry();
    for (let index = 0; index <= MAP_FAMILIAR_LIMIT; index += 1) crowd.apply(event(`${state}-${index}`, `session-${index}`, state));
    assert.equal(crowd.visible.length, MAP_FAMILIAR_LIMIT);
    assert.equal(crowd.hidden.length, 1);
    assertNoOverlap(crowd);
  }
});

test("the assignment pool can use all ten familiar identities without repeats", () => {
  const registry = new AgentRegistry({ maxVisible: FAMILIARS.length });
  for (let index = 0; index < FAMILIARS.length; index += 1) {
    registry.apply(event(`family-${index}`, "catalog-test"));
  }
  assert.deepEqual(
    new Set(registry.visible.map((record) => record.familiarType)),
    new Set(FAMILIARS.map((familiar) => familiar.type))
  );
});

test("a fifth session is kept and counted even though the map seats four", () => {
  const registry = new AgentRegistry({ maxVisible: 4 });
  for (const id of ["a", "b", "c", "d"]) registry.apply(event(id, `session-${id}`, "editing"));
  const fifth = registry.apply(event("e", "overflow", "editing"));
  assert.ok(fifth, "a session the map cannot seat is still a session");
  assert.equal(registry.visible.length, 4);
  assert.equal(registry.hidden.length, 1);
  assert.equal(registry.summary.connected, 5);
  assert.equal(registry.summary.hidden, 1);
  assertNoOverlap(registry);
});

test("a session that needs you is never the one pushed off the map", () => {
  const registry = new AgentRegistry({ maxVisible: 4 });
  const stamp = (minute) => `2026-09-21T12:0${minute}:00.000Z`;
  for (const [index, id] of ["a", "b", "c", "d"].entries()) {
    registry.apply({ ...event(id, `session-${id}`, "editing"), timestamp: stamp(index + 1) });
  }
  const blocked = registry.apply({ ...event("e", "session-e", "needs_input"), timestamp: stamp(5) });
  assert.ok(blocked);
  const shown = registry.visible.map((record) => record.sessionId);
  assert.ok(shown.includes("e"), "the blocked session must take a place on the map");
  // The one that yielded is the quietest worker, not an arbitrary victim.
  assert.equal(registry.hidden[0].sessionId, "a");
  assert.equal(registry.summary.waiting, 1);
});

test("tracks attention and completion independently across sessions", () => {
  const registry = new AgentRegistry();
  registry.apply(event("a", "session-a", "needs_input"));
  registry.apply(event("b", "session-b", "finished"));
  registry.apply(event("c", "session-c", "testing"));
  assert.deepEqual(registry.summary, { connected: 3, hidden: 0, active: 1, waiting: 1, finished: 1 });
});

test("subagent events never move their parent familiar", () => {
  const registry = new AgentRegistry();
  const record = registry.apply(event("a", "session-a", "editing"));
  const destination = record.controller.destination;
  registry.apply({ ...event("a", "claude-code", null), subagentDelta: 1 });
  assert.equal(record.subagents, 1);
  assert.equal(record.controller.destination, destination);
});

test("a new session takes the place of the quietest resting one, never of active work", () => {
  const registry = new AgentRegistry({ maxVisible: 4 });
  registry.apply({ ...event("a", "session-a", "finished"), timestamp: "2026-09-21T10:00:00.000Z" });
  registry.apply({ ...event("b", "session-b", "finished"), timestamp: "2026-09-21T11:00:00.000Z" });
  registry.apply(event("c", "session-c", "editing"));
  registry.apply(event("d", "session-d", "testing"));
  const replacement = registry.apply(event("e", "session-e", "editing"));
  assert.ok(replacement);

  const shown = new Set(registry.visible.map((record) => record.key));
  // Nothing is forgotten — the oldest finished session simply steps off the map.
  assert.equal(registry.records.size, 5);
  assert.equal(shown.has("a"), false);
  assert.equal(shown.has("b"), true);
  assert.ok(["c", "d", "e"].every((key) => shown.has(key)), "working sessions keep their places");
  assertNoOverlap(registry);
});

test("an ended session leaves the Patch and frees its occupancy slot", () => {
  const registry = new AgentRegistry();
  registry.apply(event("a", "session-a", "editing"));
  registry.apply(event("b", "session-b", "testing"));
  const removed = registry.apply({
    sessionId: "a", timestamp: new Date().toISOString(), type: "session_ended", removesSession: true
  });
  assert.equal(removed.removed, true);
  assert.equal(registry.records.has("a"), false);
  const replacement = registry.apply(event("c", "session-c", "editing"));
  assert.equal(replacement.controller.occupancySlot, 0);
});

test("an older end event cannot remove a newer live session", () => {
  const registry = new AgentRegistry();
  registry.apply({ ...event("a", "session-a", "editing"), timestamp: "2026-09-24T12:00:02.000Z" });
  const ignored = registry.apply({
    sessionId: "a", timestamp: "2026-09-24T12:00:01.000Z",
    type: "session_ended", removesSession: true
  });
  assert.equal(ignored, null);
  assert.equal(registry.records.has("a"), true);
});

test("the session id alone identifies a familiar", () => {
  const registry = new AgentRegistry();
  registry.apply(event("same", "first", "editing"));
  registry.apply(event("same", "second", "testing"));
  assert.equal(registry.visible.length, 1, "one session id is one familiar");
  assert.equal(registry.visible[0].key, "same");

  registry.apply(event("other", "third", "editing"));
  assert.equal(registry.visible.length, 2);
  assert.equal(new Set(registry.visible.map((record) => record.familiarType)).size, 2);
});

test("a session keeps the same familiar when later events arrive", () => {
  const registry = new AgentRegistry();
  const first = registry.apply(event("stable", "session-a", "editing"));
  const familiarType = first.familiarType;
  registry.apply(event("stable", "session-a", "testing"));
  assert.equal(registry.visible[0].familiarType, familiarType);
});

test("older events cannot rewind a newer session state", () => {
  const registry = new AgentRegistry();
  registry.apply({ ...event("a", "session-a", "idle"), timestamp: "2026-09-21T12:00:02.000Z" });
  registry.apply({ ...event("a", "session-a", "testing"), timestamp: "2026-09-21T12:00:01.000Z" });
  assert.equal(registry.visible[0].controller.state, "idle");
  assert.equal(registry.visible[0].lastEventAt, "2026-09-21T12:00:02.000Z");
});

test("snapshots set an absolute helper count without double counting", () => {
  const registry = new AgentRegistry();
  registry.apply({ ...event("a", "session-a", "editing"), subagentCount: 2 });
  registry.apply({ ...event("a", "session-a", null), subagentCount: 2, subagentDelta: 0 });
  assert.equal(registry.visible[0].subagents, 2);
});

test("registry reports arrival so location copy can update truthfully", () => {
  const registry = new AgentRegistry();
  const record = registry.apply(event("a", "session-a", "testing"));
  assert.equal(record.controller.moving, true);
  let arrived = false;
  for (let step = 0; step < 200 && !arrived; step += 1) arrived = registry.update(0.05);
  assert.equal(arrived, true);
  assert.equal(record.controller.currentNode, "test_dungeon");
});

test("a done familiar walks to the campfire once it has been quiet long enough", () => {
  const registry = new AgentRegistry();
  const at = "2026-09-21T12:00:00.000Z";
  registry.apply({ ...event("a", "session-a", "finished"), timestamp: at });
  registry.apply({ ...event("b", "session-b", "needs_input"), timestamp: at });

  assert.equal(registry.settle(Date.parse(at) + 60_000), false);
  assert.equal(find(registry, "a").controller.state, "finished");

  assert.equal(registry.settle(Date.parse(at) + IDLE_AFTER_MS), true);
  assert.equal(find(registry, "a").controller.state, "idle");
  assert.equal(find(registry, "a").controller.destination, "campfire");
  // The trail records the walk, so the drawer can show when it went quiet.
  assert.equal(find(registry, "a").trail[0].state, "idle");
  // A session that needs you never settles out of asking.
  assert.equal(find(registry, "b").controller.state, "needs_input");
  // Settling is idempotent: the same clock must not re-announce the move.
  assert.equal(registry.settle(Date.parse(at) + IDLE_AFTER_MS), false);
});

test("a familiar that has gone idle yields its place before a working one does", () => {
  const registry = new AgentRegistry({ maxVisible: 4 });
  const at = Date.parse("2026-09-21T12:00:00.000Z");
  const stamp = (offsetMinutes) => new Date(at + offsetMinutes * 60_000).toISOString();
  registry.apply({ ...event("a", "session-a", "finished"), timestamp: stamp(0) });
  for (const id of ["b", "c", "d"]) {
    registry.apply({ ...event(id, `session-${id}`, "editing"), timestamp: stamp(30) });
  }
  registry.settle(at + 31 * 60_000);
  assert.equal(find(registry, "a").controller.state, "idle");

  const arriving = registry.apply({ ...event("e", "overflow", "editing"), timestamp: stamp(31) });
  assert.ok(arriving, "the quiet session should have yielded its place");
  assert.equal(registry.visible.length, 4);
  assert.equal(registry.hidden.length, 1);
  assert.equal(registry.hidden[0].sessionId, "a", "the idle one steps off, not a working one");
  // Stepping off the map is not leaving: it is still connected and still counted.
  assert.equal(registry.summary.connected, 5);
});

test("a placeholder project never overwrites the one a session already reported", () => {
  const registry = new AgentRegistry();
  registry.apply({ ...event("a", "session-a", "investigating"), repository: "level-chinese", taskLabel: "Audit imports" });
  registry.apply({ ...event("a", "session-a", "needs_input"), repository: "unlabeled-repo", taskLabel: "Unlabeled task" });
  const record = registry.visible[0];
  assert.equal(record.repository, "level-chinese");
  assert.equal(record.taskLabel, "Audit imports");
});

test("connecting agents never auto-opens the inspector on one of them", () => {
  const registry = new AgentRegistry();
  registry.apply(event("a", "session-a", "editing"));
  registry.apply(event("b", "session-b", "needs_input"));
  assert.equal(registry.selectedId, null, "at rest the page is the world, not a session");
  assert.equal(registry.selected, null);
});

test("the arrows step through familiars in map order and wrap", () => {
  const registry = new AgentRegistry();
  for (const id of ["a", "b", "c"]) registry.apply(event(id, `session-${id}`));
  const order = registry.visible.sort((l, r) => l.controller.occupancySlot - r.controller.occupancySlot).map((r) => r.key);
  assert.equal(registry.cycle(1).key, order[0]);
  assert.equal(registry.cycle(1).key, order[1]);
  assert.equal(registry.cycle(-1).key, order[0]);
  assert.equal(registry.cycle(-1).key, order.at(-1), "stepping back past the first wraps to the last");
});

test("finding a familiar under the pointer does not move the selection", () => {
  const registry = new AgentRegistry();
  const record = registry.apply(event("a", "session-a", "editing"));
  const { x, y } = record.controller.position;
  assert.equal(registry.findNearest(x, y).key, record.key);
  assert.equal(registry.selectedId, null, "hovering is not choosing");
  assert.equal(registry.selectNearest(x, y).key, record.key);
  assert.equal(registry.selectedId, record.key);
});

test("a familiar named by the bridge is the one drawn, and identity rides along", () => {
  const registry = new AgentRegistry();
  const record = registry.apply({
    sessionId: "bridge-named", type: "session_started", visualState: "arriving", timestamp: "2026-09-24T10:00:00Z",
    familiarType: "nettle", agentName: "Claude", sessionName: "growth-report", terminalProgram: "iTerm", terminalTty: "ttys004"
  });
  assert.equal(record.familiarType, "nettle");
  assert.equal(record.agentName, "Nettle");
  assert.equal(record.sessionName, "growth-report");
  assert.equal(record.terminalTty, "ttys004");
  assert.equal(record.terminalProgram, "iTerm");
  // A type the catalog does not know falls back to a local choice rather than a blank sprite.
  const unknown = registry.apply({ sessionId: "odd", type: "session_started", visualState: "arriving", timestamp: "2026-09-24T10:00:01Z", familiarType: "dragon" });
  assert.ok(FAMILIARS.some((familiar) => familiar.type === unknown.familiarType));
});

/* The goodbye. A session that ends does not blink out: its familiar turns,
   walks down to the gate at the foot of the clearing, and goes through it.
   While it walks it is drawn and can be hovered and watched in the panel, but
   it is no longer a session — not counted, not seated, not selectable. */
test("an ended session walks out through the gate before it is gone", () => {
  const registry = new AgentRegistry();
  registry.apply(event("a", "session-a", "editing"));
  registry.apply(event("b", "session-b", "testing"));
  registry.selectedId = "a";
  const removed = registry.apply({ sessionId: "a", timestamp: new Date().toISOString(), type: "session_ended", removesSession: true });
  assert.equal(removed.removed, true);

  const walker = registry.departing.get("a");
  assert.ok(walker, "the familiar is on its way out");
  assert.equal(walker.controller.leaving, true);
  assert.equal(walker.controller.destination, EXIT_NODE);
  assert.equal(walker.controller.moving, true);
  assert.equal(registry.records.has("a"), false, "but it is not a session");
  assert.equal(registry.visible.length, 1, "nor does it hold a place");
  assert.equal(registry.summary.connected, 1, "nor is it counted");
  assert.equal(registry.drawn.length, 2, "it is drawn");
  assert.equal(registry.selected?.key, "a", "the panel follows it to the gate");

  // Hovering finds it; clicking does not. (Alone, so nobody shares its spot.)
  const alone = new AgentRegistry();
  alone.apply(event("solo", "session-solo", "editing"));
  alone.apply({ sessionId: "solo", timestamp: new Date().toISOString(), type: "session_ended", removesSession: true });
  const { x, y } = alone.departing.get("solo").controller.position;
  assert.equal(alone.findNearest(x, y, 28, { departing: true })?.key, "solo");
  assert.equal(alone.findNearest(x, y, 28), null);

  // State can no longer steer it, and seating cannot move it.
  assert.equal(walker.controller.setState("testing"), false);
  assert.equal(walker.controller.setPlacement(1, 2), false);
  assert.equal(walker.controller.destination, EXIT_NODE);

  // It walks, fades over the last stretch, and is gone once through.
  let steps = 0;
  while (registry.departing.has("a") && steps < 600) { registry.update(0.05); steps += 1; }
  assert.ok(steps > 4, "the walk takes time");
  assert.equal(registry.departing.has("a"), false, "through the gate");
  assert.equal(registry.selectedId, null, "and the panel lets go");
  assert.equal(registry.visible.length, 1);
});

test("the fade runs over the last stretch of the walk out", () => {
  const registry = new AgentRegistry();
  registry.apply(event("a", "session-a", "finished"));
  registry.apply({ sessionId: "a", timestamp: new Date().toISOString(), type: "disconnected", removesSession: true });
  const controller = registry.departing.get("a").controller;
  assert.equal(controller.departure, 0, "fully present at the turn");
  controller.position = { x: nodes[EXIT_NODE].x, y: nodes[EXIT_NODE].y - 35 };
  assert.ok(controller.departure > 0.4 && controller.departure < 0.6, "half gone halfway through the fade");
  controller.position = { ...nodes[EXIT_NODE] };
  assert.equal(controller.departure, 1);
});

test("a hand-over and a take-back are instant; only a real ending gets a goodbye", () => {
  for (const type of ["superseded", "unproven", "reset"]) {
    const registry = new AgentRegistry();
    registry.apply(event("a", "session-a", "editing"));
    registry.selectedId = "a";
    registry.apply({ sessionId: "a", timestamp: new Date().toISOString(), type, removesSession: true });
    assert.equal(registry.departing.size, 0, `${type} does not walk out`);
    assert.equal(registry.drawn.length, 0);
    assert.equal(registry.selectedId, null);
  }
  // A session that was connected but never drawn was never there to leave.
  const crowded = new AgentRegistry({ maxVisible: 1 });
  crowded.apply(event("shown", "session-shown", "editing"));
  crowded.apply(event("hidden", "session-hidden", "idle"));
  assert.equal(crowded.hidden[0].key, "hidden");
  crowded.apply({ sessionId: "hidden", timestamp: new Date().toISOString(), type: "session_ended", removesSession: true });
  assert.equal(crowded.departing.size, 0);
});

test("a farewell that stalls is ended by the clock, and a session that comes back is a session", () => {
  const registry = new AgentRegistry();
  registry.apply(event("a", "session-a", "editing"));
  const at = Date.now();
  registry.apply({ sessionId: "a", timestamp: new Date(at).toISOString(), type: "session_ended", removesSession: true });
  const walker = registry.departing.get("a");
  walker.controller.path = ["nowhere"]; // a walk that can never arrive
  walker.controller.update = () => {};
  registry.update(0.05, at + FAREWELL_MAX_MS - 1);
  assert.ok(registry.departing.has("a"));
  registry.update(0.05, at + FAREWELL_MAX_MS + 1);
  assert.equal(registry.departing.has("a"), false);

  registry.apply(event("b", "session-b", "editing"));
  registry.apply({ sessionId: "b", timestamp: new Date().toISOString(), type: "session_ended", removesSession: true });
  assert.ok(registry.departing.has("b"));
  registry.apply({ ...event("b", "session-b", "editing"), timestamp: new Date(Date.now() + 10).toISOString() });
  assert.equal(registry.departing.has("b"), false, "re-admitted, so no longer leaving");
  assert.equal(registry.records.get("b").controller.leaving, false);
  assert.equal(registry.visible.length, 1);
});

test("five waiting sessions stay inspectable without changing the four map places", () => {
  const registry = new AgentRegistry({ maxVisible: 4 });
  for (let index = 0; index < 5; index++) registry.apply(event(`waiting-${index}`, `Session ${index}`, "needs_input"));
  const hidden = registry.hidden[0];
  registry.selectedId = hidden.key;
  registry.refreshVisibility();
  assert.equal(registry.selected, hidden);
  assert.equal(registry.visible.length, 4);
  assert.equal(registry.summary.waiting, 5);
  const visited = new Set();
  for (let index = 0; index < 5; index++) visited.add(registry.cycle(1).key);
  assert.equal(visited.size, 5);
  registry.selectedId = hidden.key;
  registry.apply({ ...event(hidden.key, hidden.agentName), removesSession: true, type: "session_ended" });
  assert.equal(registry.selected, null);
});

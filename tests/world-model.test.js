import test from "node:test";
import assert from "node:assert/strict";
import { AgentController, destinationByState, EXIT_NODE, hasBespokeSeats, MAP_FAMILIAR_LIMIT, nodes, shortestPath, stationPosition } from "../src/world-model.js";
import { VISUAL_STATES } from "../src/state-machine.js";

test("every visual state has a valid physical destination", () => {
  for (const state of Object.values(VISUAL_STATES)) {
    assert.ok(destinationByState[state] === "home" || nodes[destinationByState[state]], `${state} has no valid destination`);
  }
});

test("authored graph routes from the workbench to all critical stations", () => {
  for (const destination of ["research", "command", "test_dungeon", "permission_gate", "shipping_dock"]) {
    const path = shortestPath("workbench", destination);
    assert.equal(path[0], "workbench");
    assert.equal(path.at(-1), destination);
    assert.ok(path.length >= 2);
  }
});

test("agent reaches the permission gate deterministically", () => {
  const agent = new AgentController({ start: "workbench", occupancySlot: 2, speed: 200 });
  agent.setState(VISUAL_STATES.NEEDS_INPUT);
  for (let step = 0; step < 100 && agent.moving; step += 1) agent.update(0.05);
  assert.equal(agent.currentNode, "permission_gate");
  assert.deepEqual(agent.position, stationPosition("permission_gate", 2));
});

test("a newer state safely replaces an in-flight destination", () => {
  const agent = new AgentController({ start: "workbench", speed: 100 });
  agent.setState(VISUAL_STATES.TESTING);
  agent.update(0.2);
  agent.setState(VISUAL_STATES.NEEDS_INPUT);
  assert.equal(agent.path[0], "workbench", "agent should return to its last authored node before rerouting");
  for (let step = 0; step < 200 && agent.moving; step += 1) agent.update(0.05);
  assert.equal(agent.currentNode, "permission_gate");
});

test("a familiar alone at a station stands on it, not beside it", () => {
  for (const node of ["command", "shipping_dock", "permission_gate", "workbench", "research", "test_dungeon"]) {
    assert.deepEqual(stationPosition(node, 0, 1), nodes[node], `${node} must seat one familiar dead centre`);
  }
});

test("the campfire seats familiars around the fire instead of inside it", () => {
  assert.ok(hasBespokeSeats("campfire"), "the campfire anchor is a bonfire, not standing room");
  for (let crowd = 1; crowd <= MAP_FAMILIAR_LIMIT; crowd += 1) {
    const seats = [...Array(crowd).keys()].map((slot) => stationPosition("campfire", slot, crowd));
    assert.equal(new Set(seats.map(({ x, y }) => `${x},${y}`)).size, crowd, "campfire seats must be distinct");
    for (const seat of seats) {
      // Clear of the painted flame, and still recognisably at the fire.
      assert.ok(seat.y > nodes.campfire.y, "a familiar must sit on the near side of the fire, never in it");
      assert.ok(Math.hypot(seat.x - nodes.campfire.x, seat.y - nodes.campfire.y) < 70, "seats stay at the campfire");
    }
  }
});

test("shared stations fan sessions into stable nearby positions", () => {
  for (const crowd of [2, 3, 4]) {
    const positions = [...Array(crowd).keys()].map((slot) => stationPosition("command", slot, crowd));
    assert.equal(new Set(positions.map(({ x, y }) => `${x},${y}`)).size, crowd, `${crowd} familiars must not stack`);
    assert.ok(positions.every(({ x, y }) => Math.hypot(x - nodes.command.x, y - nodes.command.y) < 52));
  }
});

/* The way out is drawn on the plate: the chained gate at the foot of the south
   path. Every station can reach it, and the walk there always ends by going
   down through the ring and out of the picture. */
test("every station has a walk to the gate, and it leaves by the south path", () => {
  assert.ok(nodes[EXIT_NODE].y > 288, "the gate node is past the bottom of the plate, so the walk leaves the picture");
  for (const station of new Set(Object.values(destinationByState))) {
    const route = shortestPath(station, EXIT_NODE);
    assert.ok(route.length >= 2, `${station} cannot reach the gate`);
    assert.deepEqual(route.slice(-2), ["ring_south", EXIT_NODE], `${station} must leave down the south path`);
  }
  assert.ok(!Object.values(destinationByState).includes(EXIT_NODE), "no lifecycle state sends a familiar out");
});

test("a familiar told to leave walks out and cannot be called back by state", () => {
  const controller = new AgentController({ start: "shipping_dock" });
  assert.equal(controller.leave(), true);
  assert.equal(controller.leave(), false, "leaving twice is leaving once");
  assert.equal(controller.destination, EXIT_NODE);
  assert.equal(controller.setState("editing"), false);
  for (let step = 0; step < 400 && controller.moving; step += 1) controller.update(0.05);
  assert.equal(controller.moving, false);
  assert.deepEqual(controller.position, nodes[EXIT_NODE]);
  assert.equal(controller.departure, 1);
});

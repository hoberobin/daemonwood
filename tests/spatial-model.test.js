import test from "node:test";
import assert from "node:assert/strict";
import { agentLocation, stationCatalog, stationDetails } from "../src/spatial-model.js";
import { destinationByState } from "../src/world-model.js";

test("every fixed state destination has human spatial meaning", () => {
  for (const destination of Object.values(destinationByState)) {
    if (destination === "home") continue;
    assert.ok(stationCatalog[destination], destination + " is missing station copy");
  }
});

test("core workflow states occupy distinct places", () => {
  const destinations = ["investigating", "running", "testing", "needs_input", "finished"]
    .map((state) => destinationByState[state]);
  assert.equal(new Set(destinations).size, destinations.length);
});

test("location copy distinguishes travel from arrival", () => {
  const traveling = agentLocation({ destination: "test_dungeon", state: "testing", moving: true });
  const arrived = agentLocation({ destination: "test_dungeon", state: "testing", moving: false });
  assert.equal(traveling.label, "Heading to Test Dungeon");
  assert.equal(traveling.arrived, false);
  assert.equal(arrived.label, "Test Dungeon");
  assert.equal(arrived.arrived, true);
});

test("the shared workbench receives a readable label", () => {
  assert.deepEqual(stationDetails("workbench", "editing"), {
    label: "Workbench",
    meaning: "Preparing or editing"
  });
});

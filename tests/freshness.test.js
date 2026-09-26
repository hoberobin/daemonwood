import test from "node:test";
import assert from "node:assert/strict";
import { eventFreshness } from "../src/freshness.js";

const now = Date.parse("2026-09-21T12:10:00.000Z");

test("freshness labels recent events without changing lifecycle state", () => {
  assert.deepEqual(eventFreshness("2026-09-21T12:09:55.000Z", now), {
    label: "Updated just now", tone: "fresh", ageMs: 5_000
  });
  assert.equal(eventFreshness("2026-09-21T12:09:25.000Z", now).label, "Updated 35s ago");
  assert.equal(eventFreshness("2026-09-21T12:08:00.000Z", now).label, "Updated 2m ago");
});

test("quiet events are disclosed but not called disconnected", () => {
  const result = eventFreshness("2026-09-21T11:58:00.000Z", now);
  assert.equal(result.label, "Quiet for 12m");
  assert.equal(result.tone, "quiet");
});

test("invalid timestamps remain honest", () => {
  assert.equal(eventFreshness("not-a-date", now).label, "No events yet");
});

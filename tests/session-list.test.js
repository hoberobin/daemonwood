import test from "node:test";
import assert from "node:assert/strict";
import { orderedSessions, createSessionAnnouncer } from "../src/session-list.js";
const record = (key, state, minute = 0) => ({ key, agentName: key, repository: `${key}-project`,
  controller: { state }, trail: [{ at: `2026-09-26T12:0${minute}:00Z` }], lastEventAt: "2026-09-26T12:09:00Z" });

test("the attention queue reaches all waiting sessions and keeps oldest requests first", () => {
  const records = [record("new", "needs_input", 4), record("working", "editing"), record("old", "needs_input", 1), record("trouble", "trouble")];
  assert.deepEqual(orderedSessions(records, true).map((r) => r.key), ["old", "new"]);
  assert.deepEqual(orderedSessions(records).map((r) => r.key), ["old", "new", "trouble", "working"]);
});
test("attention is announced without a selection and freshness cannot repeat it", () => {
  const announce = createSessionAnnouncer();
  const waiting = record("Moss", "needs_input");
  assert.match(announce([waiting], null), /Moss.*needs you/);
  waiting.lastEventAt = "2026-09-26T13:00:00Z";
  assert.equal(announce([waiting], null), "");
  assert.match(announce([waiting], waiting), /Needs you/);
  assert.equal(announce([waiting], waiting), "");
  waiting.controller.state = "editing";
  assert.match(announce([waiting], waiting), /No sessions need your input.*Editing/);
});

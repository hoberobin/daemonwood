import test from "node:test";
import assert from "node:assert/strict";
import { connectionStatus } from "../src/connection-status.js";

const setup = { file: "~/.claude/settings.json", hooks: { configured: 12, total: 12 } };
const delivery = { hookEvents: 2, lastHookReceivedAt: "2026-09-26T12:00:00Z" };
test("installed hooks and discovered sessions do not prove event delivery", () => {
  const installed = connectionStatus({ setup, bridge: "live", sessions: 2 });
  assert.equal(installed.label, "Ready for Claude Code");
  assert.equal(installed.active, false);
  assert.match(installed.details, /No hook events received/);
  const scoped = connectionStatus({ setup: { hooks: { configured: 0, total: 12 } }, bridge: "live", sessions: 1 });
  assert.equal(scoped.label, "Claude sessions detected");
  assert.match(scoped.details, /project-local settings are not checked/);
});
test("receipt is retained during quiet work but cannot hide a bridge outage", () => {
  assert.equal(connectionStatus({ setup, delivery, bridge: "live" }).active, true);
  const offline = connectionStatus({ setup, delivery, bridge: "offline" });
  assert.equal(offline.label, "Reconnecting…");
  assert.equal(offline.active, false);
  assert.match(offline.details, /out of date/);
  assert.match(offline.details, /2 hook events received/);
});
test("a bridge restart with no receipt does not inherit verified delivery", () => {
  assert.equal(connectionStatus({ setup, delivery: { hookEvents: 0, lastHookReceivedAt: null }, bridge: "live" }).active, false);
  assert.equal(connectionStatus().label, "Connecting to bridge");
});
test("blocked, unreadable and partial setups ask for action instead of looking settled", () => {
  const blocked = connectionStatus({ setup: { ...setup, blocked: true }, delivery, bridge: "live" });
  assert.equal(blocked.label, "Claude Code hooks are disabled");
  assert.equal(blocked.active, false);
  assert.equal(blocked.settled, false);
  const unreadable = connectionStatus({ setup: { error: "Claude settings could not be read." }, bridge: "live" });
  assert.equal(unreadable.problem, "unreadable");
  assert.match(unreadable.details, /could not be read/);
  const partial = connectionStatus({ setup: { hooks: { configured: 9, total: 12 } }, bridge: "live" });
  assert.equal(partial.label, "The Patch needs a quick repair");
  assert.equal(partial.settled, false);
});

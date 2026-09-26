import test from "node:test";
import assert from "node:assert/strict";
import { deriveVisualState, IDLE_AFTER_MS, restingStateFor, sanitizeHookEvent, summarizeSessions, VISUAL_STATES } from "../src/state-machine.js";

test("maps supported lifecycle events to truthful visual states", () => {
  assert.equal(deriveVisualState({ type: "session_started" }), VISUAL_STATES.ARRIVING);
  assert.equal(deriveVisualState({ type: "tool_started", category: "read" }), VISUAL_STATES.INVESTIGATING);
  assert.equal(deriveVisualState({ type: "tool_started", category: "edit" }), VISUAL_STATES.EDITING);
  assert.equal(deriveVisualState({ type: "tool_started", category: "test" }), VISUAL_STATES.TESTING);
  assert.equal(deriveVisualState({ type: "needs_input" }), VISUAL_STATES.NEEDS_INPUT);
  assert.equal(deriveVisualState({ type: "completed" }), VISUAL_STATES.FINISHED);
  // The end of a turn is the only "it stopped working" Claude reports.
  assert.equal(deriveVisualState({ type: "stopped" }), VISUAL_STATES.FINISHED);
  assert.equal(deriveVisualState({ type: "session_ended" }), null);
  assert.equal(deriveVisualState({ type: "unknown" }), null);
});

test("subagent events change helper count without claiming a visual state", () => {
  const started = sanitizeHookEvent({ type: "subagent_started", sessionId: "s-1" });
  const stopped = sanitizeHookEvent({ type: "subagent_stopped", sessionId: "s-1" });
  assert.equal(started.visualState, null);
  assert.equal(started.subagentDelta, 1);
  assert.equal(stopped.subagentDelta, -1);
});

test("terminal connection events remove a session instead of creating an inactive state", () => {
  for (const type of ["session_ended", "disconnected", "unproven", "superseded", "reset"]) {
    const safe = sanitizeHookEvent({ type, sessionId: "s-1" });
    assert.equal(safe.visualState, null);
    assert.equal(safe.removesSession, true);
  }
});

test("sanitizer keeps only safe display metadata", () => {
  const safe = sanitizeHookEvent({
    id: "evt-1", sessionId: "s-1", timestamp: "2026-09-21T00:00:00Z", type: "tool_started", category: "edit",
    repository: "/Users/hobe/secret/client/web-app", taskLabel: "Improve the prototype",
    agentName: "Builder\u0000 One",
    prompt: "private prompt", tool_input: { file_path: "/secret/file.ts" }, command: "cat .env",
    ownerPid: 1234, ownerStartedAt: "Thu Sep 24 10:00:01 2026"
  });
  assert.equal(safe.repository, "web-app");
  assert.equal(safe.visualState, VISUAL_STATES.EDITING);
  assert.equal("provider" in safe, false, "one source means no provider tag to carry");
  assert.equal(safe.agentName, "Builder One");
  assert.equal(safe.ownerPid, 1234);
  assert.equal(safe.ownerStartedAt, "Thu Sep 24 10:00:01 2026");
  assert.equal(safe.terminalProgram, undefined, "no terminal claimed means no terminal shown");

  const named = sanitizeHookEvent({ type: "stopped", sessionId: "s-1", terminalProgram: "VS\u0000 Code", familiarType: "moss", terminalTty: "ttys009", sessionName: "mine" });
  assert.equal(named.terminalProgram, "VS Code");
  // Which familiar a session is, and which tty it sits on, are the bridge's to say.
  assert.equal("familiarType" in named, false);
  assert.equal("terminalTty" in named, false);
  assert.equal("sessionName" in named, false);
  assert.equal("prompt" in safe, false);
  assert.equal("tool_input" in safe, false);
  assert.equal("command" in safe, false);
});

test("a finished session ages into idle, and nothing else does", () => {
  const at = "2026-09-21T12:00:00.000Z";
  const justNow = Date.parse(at) + 1_000;
  const later = Date.parse(at) + IDLE_AFTER_MS;

  assert.equal(restingStateFor(VISUAL_STATES.FINISHED, at, justNow), VISUAL_STATES.FINISHED);
  assert.equal(restingStateFor(VISUAL_STATES.FINISHED, at, later), VISUAL_STATES.IDLE);
  assert.equal(restingStateFor(VISUAL_STATES.ARRIVING, at, later), VISUAL_STATES.IDLE);

  // A session that still needs you, or that broke, keeps saying so forever.
  assert.equal(restingStateFor(VISUAL_STATES.NEEDS_INPUT, at, later), VISUAL_STATES.NEEDS_INPUT);
  assert.equal(restingStateFor(VISUAL_STATES.TROUBLE, at, later), VISUAL_STATES.TROUBLE);
  // Long-running work is still work; only the freshness line comments on it.
  assert.equal(restingStateFor(VISUAL_STATES.RUNNING, at, later), VISUAL_STATES.RUNNING);
  assert.equal(restingStateFor(VISUAL_STATES.FINISHED, "not a date", later), VISUAL_STATES.FINISHED);
});

test("session summaries distinguish active, waiting, and finished", () => {
  const summary = summarizeSessions(new Map([
    ["a", { state: VISUAL_STATES.EDITING }],
    ["b", { state: VISUAL_STATES.NEEDS_INPUT }],
    ["c", { state: VISUAL_STATES.FINISHED }],
    ["d", { state: VISUAL_STATES.IDLE }]
  ]));
  assert.deepEqual(summary, { active: 1, waiting: 1, finished: 1 });
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSessionTitle, titleFromTail } from "../hooks/session-title.js";
import { normalizeClaudeHook } from "../hooks/normalize-claude-event.js";
import { sanitizeHookEvent } from "../src/state-machine.js";
import { sessionTitle } from "../src/session-address.js";

const line = (value) => JSON.stringify(value);

test("the tab title comes from the transcript's ai-title line and nothing else", () => {
  const tail = [
    line({ type: "user", message: { content: "please fix the private thing" }, sessionId: "s1" }),
    line({ type: "ai-title", aiTitle: "Character drawer titles", sessionId: "s1" }),
    line({ type: "assistant", message: { content: "done" }, sessionId: "s1" })
  ].join("\n");
  assert.equal(titleFromTail(tail, "s1"), "Character drawer titles");
});

test("a /rename wins over the generated title, as it does on the tab", () => {
  const tail = [
    line({ type: "custom-title", customTitle: "growth report", sessionId: "s1" }),
    line({ type: "ai-title", aiTitle: "Quarterly numbers", sessionId: "s1" })
  ].join("\n");
  assert.equal(titleFromTail(tail, "s1"), "growth report");
});

test("the latest title wins, another session's title is ignored, and a torn first line is skipped", () => {
  const tail = [
    '"aiTitle":"torn off the front","sessionId":"s1"}',
    line({ type: "ai-title", aiTitle: "First guess", sessionId: "s1" }),
    line({ type: "ai-title", aiTitle: "Somebody else", sessionId: "s2" }),
    line({ type: "ai-title", aiTitle: "Better guess", sessionId: "s1" })
  ].join("\n");
  assert.equal(titleFromTail(tail, "s1"), "Better guess");
});

test("titles are one clean line, capped, and absent rather than empty", () => {
  assert.equal(titleFromTail(line({ type: "ai-title", aiTitle: "  two\nlines\u0007 " }), null), "two lines");
  assert.equal(titleFromTail(line({ type: "ai-title", aiTitle: "x".repeat(200) }), null).length, 80);
  assert.equal(titleFromTail(line({ type: "ai-title", aiTitle: "   " }), null), null);
  assert.equal(titleFromTail("", "s1"), null);
});

test("only the tail of the file is read, and a missing file is no title", () => {
  const dir = mkdtempSync(join(tmpdir(), "patch-title-"));
  const file = join(dir, "s1.jsonl");
  writeFileSync(file, [
    line({ type: "ai-title", aiTitle: "Early title", sessionId: "s1" }),
    line({ type: "user", message: { content: "y".repeat(5000) }, sessionId: "s1" }),
    line({ type: "ai-title", aiTitle: "Late title", sessionId: "s1" })
  ].join("\n") + "\n");
  assert.equal(readSessionTitle(file, "s1"), "Late title");
  assert.equal(readSessionTitle(file, "s1", { tailBytes: 1000 }), "Late title");
  assert.equal(readSessionTitle(join(dir, "missing.jsonl"), "s1"), null);
  assert.equal(readSessionTitle(undefined, "s1"), null);
  assert.equal(readSessionTitle(join(dir, "not-a-transcript.txt"), "s1"), null);
});

test("the title rides the event as its task label and reaches the drawer", () => {
  const event = normalizeClaudeHook({ hook_event_name: "Stop", session_id: "s1", cwd: "/work/web-app" }, { title: "Character drawer titles" });
  assert.equal(event.taskLabel, "Character drawer titles");
  const safe = sanitizeHookEvent(event);
  assert.equal(sessionTitle(safe), "Character drawer titles");
  const untitled = sanitizeHookEvent(normalizeClaudeHook({ hook_event_name: "Stop", session_id: "s1" }));
  assert.equal(sessionTitle(untitled), "", "the placeholder is not a title");
});

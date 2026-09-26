import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClaudeHook, terminalLabel } from "../hooks/normalize-claude-event.js";

test("Claude edit events are sanitized down to what the map may show", () => {
  const event = normalizeClaudeHook({
    hook_event_name: "PreToolUse",
    session_id: "abc",
    cwd: "/work/web-app",
    tool_name: "Edit",
    tool_input: { file_path: "/secret/source.js" },
    prompt: "private prompt"
  });
  assert.equal(event.type, "tool_started");
  assert.equal(event.category, "edit");
  assert.equal(event.repository, "web-app");
  assert.equal("tool_input" in event, false);
  assert.equal("prompt" in event, false);
});

test("Claude Bash test commands are categorized without retaining commands", () => {
  const event = normalizeClaudeHook({
    hook_event_name: "PreToolUse",
    session_id: "abc",
    cwd: "/work/api",
    tool_name: "Bash",
    tool_input: { command: "npm test -- --runInBand" }
  });
  assert.equal(event.category, "test");
  assert.equal("command" in event, false);
});

test("Stop ends the turn; task-list hooks and classifier denials never reach the Permission Gate", () => {
  assert.equal(normalizeClaudeHook({ hook_event_name: "Stop", session_id: "a" }).type, "stopped");
  /* TaskCreated and TaskCompleted fire for the session's own to-do list
     (TaskCreate / TaskUpdate), verified live: task_id and task_subject, no
     teammate. Counting them as helpers showed helpers that did not exist. */
  assert.equal(normalizeClaudeHook({ hook_event_name: "TaskCreated", session_id: "a", task_id: "1", task_subject: "count files" }), null);
  assert.equal(normalizeClaudeHook({ hook_event_name: "TaskCompleted", session_id: "a", task_id: "1", task_subject: "count files" }), null);
  /* "After auto mode classifier denies a tool call": nobody is being asked
     anything, so it is Trouble, never Needs you. */
  assert.equal(normalizeClaudeHook({ hook_event_name: "PermissionDenied", session_id: "a", tool_name: "Bash" }).type, "failure");
  assert.equal(normalizeClaudeHook({ hook_event_name: "PermissionRequest", session_id: "a" }).type, "needs_input");
  assert.equal(normalizeClaudeHook({ hook_event_name: "Notification", notification_type: "agent_completed", session_id: "a" }).type, "completed");
});

/* Verified against a live session: every hook fired inside a subagent carries
   agent_id and agent_type; the session's own hooks carry neither. A helper's
   reads are not the session's state, and its type is not the session's name. */
test("a helper's work never moves or renames the familiar; its dialogs still reach you", () => {
  const helper = { session_id: "a", cwd: "/work/app", agent_id: "a57a41ec", agent_type: "Explore" };
  assert.equal(normalizeClaudeHook({ ...helper, hook_event_name: "PreToolUse", tool_name: "Read" }), null);
  assert.equal(normalizeClaudeHook({ ...helper, hook_event_name: "PostToolUseFailure", tool_name: "Bash" }), null);
  assert.equal(normalizeClaudeHook({ ...helper, hook_event_name: "Stop" }), null);
  assert.equal(normalizeClaudeHook({ ...helper, hook_event_name: "Notification", notification_type: "idle_prompt" }), null);

  const started = normalizeClaudeHook({ ...helper, hook_event_name: "SubagentStart" });
  assert.equal(started.type, "subagent_started");
  assert.equal(started.agentName, "Claude", "the helper's type is not the session's name");
  assert.equal(normalizeClaudeHook({ ...helper, hook_event_name: "SubagentStop" }).type, "subagent_stopped");
  assert.equal(normalizeClaudeHook({ ...helper, hook_event_name: "PermissionRequest", tool_name: "Bash" }).type, "needs_input");
  assert.equal(normalizeClaudeHook({ ...helper, hook_event_name: "Notification", notification_type: "permission_prompt" }).type, "needs_input");

  // The session's own hooks, with the same fields absent, behave as before.
  assert.equal(normalizeClaudeHook({ session_id: "a", hook_event_name: "PreToolUse", tool_name: "Read" }).category, "read");
  assert.equal(normalizeClaudeHook({ session_id: "a", hook_event_name: "SessionStart", source: "clear", agent_type: "custom" }).agentName, "Claude");
});

test("the terminal is named as an app, never as a tab id or a path", () => {
  const env = { TERM_PROGRAM: "vscode", TERM_SESSION_ID: "w0t3p1:8F2B4C6E-secret", ITERM_SESSION_ID: "also-secret" };
  const event = normalizeClaudeHook({ hook_event_name: "SessionStart", session_id: "abc", cwd: "/work/app" }, { env });
  assert.equal(event.terminalProgram, "VS Code");
  assert.equal(JSON.stringify(event).includes("secret"), false);

  assert.equal(terminalLabel({ TERM_PROGRAM: "Apple_Terminal" }), "Terminal");
  assert.equal(terminalLabel({ TERM_PROGRAM: "iTerm.app" }), "iTerm");
  assert.equal(terminalLabel({ TERM_PROGRAM: "iTerm.app", TMUX_PANE: "%3" }), "iTerm · tmux %3");
  assert.equal(terminalLabel({ TERM_PROGRAM: "tmux", TMUX_PANE: "%3" }), "tmux %3");
  assert.equal(terminalLabel({ TERM_PROGRAM: "Something/Odd<>" }), "SomethingOdd");
  assert.equal(terminalLabel({}), null);
  assert.equal("terminalProgram" in normalizeClaudeHook({ hook_event_name: "Stop", session_id: "abc" }), false);
});

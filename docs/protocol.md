# The Patch event protocol — v0.1

The world knows about normalized lifecycle events, not Claude, Codex, Cursor, or any other provider. An adapter has one job: translate its provider's signals into this small payload and POST it to "http://127.0.0.1:4173/api/events".

~~~json
{
  "sessionId": "stable-session-id",
  "provider": "claude-code",
  "agentName": "Moss",
  "timestamp": "2026-09-21T12:00:00.000Z",
  "type": "tool_started",
  "category": "edit",
  "repository": "web-app",
  "taskLabel": "Growth report",
  "terminalProgram": "VS Code"
}
~~~

`taskLabel` is optional: one short line (80 characters at most) saying what the
session is about, shown under the familiar's name in the drawer and in the
session picker. The Claude Code adapter sends the session's terminal-tab
title — the `ai-title` Claude Code writes after the first prompt, or the
`/rename` that replaced it. A later event that omits it keeps the last one.

`terminalProgram` is optional: the terminal app the session is typed into, as a
label. It is the only identity fact an adapter may add. The bridge decides the
rest itself and adds it to what the browser receives: `familiarType` (which
character the session is, chosen once at admission and never shared by two live
sessions), `terminalTty` (from the process table), and `sessionName` (from
Claude Code's own note about the session, when it agrees on both pid and
session id). A sender that posts any of those three has them stripped.

`GET /api/sessions` and `GET /api/sessions/<sessionId>` return the same public
view the stream carries, so a terminal's status line can ask which familiar it
is. Identity changes that are not lifecycle events — a rename — arrive on the
stream as `patch-session` rather than `patch-event`.

## Supported types

| Type | Meaning |
| --- | --- |
| "session_started" | Agent session appeared |
| "prompt_submitted" | Agent began considering a request |
| "tool_started" | Agent began a tool; include a safe category |
| "needs_input" / "permission_requested" | Human action is required |
| "failure" | A tool or turn failed |
| "stopped" | Turn ended; the agent is no longer working (Done) |
| "completed" | Provider explicitly reported the task complete (also Done) |
| "session_ended" | Session closed; remove it from the Patch and reconnect snapshots |
| "subagent_started" / "subagent_stopped" | Helper count changed |

Tool categories are "read", "search", "edit", "write", "command", and "test". Unknown tool categories render as generic running work.

`session_ended`, `disconnected`, `superseded`, `unproven` and `reset` are removal events, not visible lifecycle states. Only `session_ended` is an adapter's to send; the others are the bridge's own verdicts. A turn-level `stopped` event is different: the session stays open, and the familiar carries its parcel to the Shipping Dock as Done.

There is no `idle` event and adapters must not invent one. Idle is derived in the
browser: a Done session that has seen no event for five minutes walks to the
Campfire on its own. Because the walk is derived from `lastEventAt` rather than
counted down, a reload or an SSE reconnect puts the familiar back where it was
standing. Needs-input and trouble never age out — they exist to keep asking.

## Process identity is mandatory

Every event must carry `ownerPid` and `ownerStartedAt`: the pid and start time of
the long-lived `claude` process the session belongs to. The local adapter finds
them by walking its own ancestry, and the bridge checks them against `ps` — both
when the event arrives and every two seconds afterwards. An event that names no
process, names a pid that is not running, names a pid that has since been reused,
names a process that is not Claude Code, or names a process whose own session
note (`~/.claude/sessions/<pid>.json`, written by Claude Code) says it hosts a
different session, is refused with `403` and never reaches the browser as a
familiar.

This is not a nicety for cleanup. It is the rule that makes the map worth
looking at: **one familiar, one running agent, no exceptions.** Without it, any
process that can reach `127.0.0.1:4173` can post a cast of agents that do not
exist — which is exactly what happened once, and cost an afternoon of trusting a
permission prompt that nobody was waiting behind.

Two deliberate softenings, and only two:

- If `ps` cannot be read at all, the event is admitted rather than refused. An
  unreadable process table is not evidence of anything, and refusing on it would
  blank the map over a transient hiccup. The reaper re-checks within seconds.
- A removal event (`session_ended`) is accepted from a session the bridge already
  knows by that exact pid, even once the process is gone. A session's last word
  can outlive it, and a removal can only take a familiar away, never add one.

Process identity is also what distinguishes an idle, still-open session from a
CLI that was killed before it could emit `session_ended`; killed sessions are
broadcast as `disconnected` and removed from reconnect snapshots.

The bridge also reads that note for what it says about the session — waiting,
busy or idle — and issues lifecycle events of its own (`needs_input`,
`stopped`, `tool_started`, `prompt_submitted`) when the note is newer than the
last event the session sent and describes a different state. Sessions whose
notes name a running process the map has never heard from are admitted the
same way. Adapters never see these; they arrive on the stream like any other.

An adapter that cannot supply local process identity cannot be trusted to keep
the map one-to-one, and the bridge will not pretend otherwise. Refusals are
counted in `/api/health` as `refusedEvents` and `lastRefusal`, streamed to the
browser as `patch-refused`, and shown in `npm run status` — a refusal you cannot
see would be its own kind of lie.

## Privacy boundary

Adapters may send identity and state metadata only. Do not send prompts, responses, source code, command text, tool inputs, transcripts, absolute paths, secrets, or tokens — and no per-tab terminal ids, which are tokens in all but name. The bridge sanitizes every event again before it reaches the browser.

## Adapter acceptance contract

Every adapter should have fixture tests proving:

1. provider events map to the correct normalized type and category;
2. private inputs never appear in adapter output;
3. helper lifecycle events (subagent/task start and stop) move only the helper count, never the session's own state;
4. stable provider session IDs stay stable across events;
5. the adapter fails open so monitoring cannot block the agent.

# The Patch terminology

The Patch uses plain operational language in controls and inspector fields. World-flavored language adds character but never carries essential meaning by itself.

## Product nouns

| Term | Meaning | UI rule |
| --- | --- | --- |
| Agent | The external AI doing work | Use when connecting or discussing integrations |
| Source | The product running the agent, such as Claude Code | Use in session details |
| Session | One monitored stream of agent work | Use for counts, selection, and operational UI |
| Session name | What Claude Code calls the session; `/rename` changes it | Shown as-is, never invented — and only when somebody chose it; the fallback slug (`web-app-6c`) is not a fact |
| Terminal | The tty and app a session is typed into, e.g. `ttys003 · VS Code` | The one address a person can check; never a tab id |
| Address | The terminal and the project together, e.g. `VS Code ttys003 · web-app` | Everywhere the page points at a session — the alert, the next step, the hover nameplate — it says this, in this order, from `src/session-address.js` |
| Familiar | The pixel character representing one session | Use in world flavor and art documentation |
| Helper | A subagent created inside a session | Use instead of “subagent” in normal UI |
| Station | A map location that communicates lifecycle state | Use when explaining the world system |
| Place | The station where the selected familiar is going or has arrived | Use in the inspector |

One top-level session equals one familiar. Helpers remain attached to their parent familiar and never receive a full workstation.

## User-facing states

| Internal state | UI label | World place |
| --- | --- | --- |
| arriving | Starting | Workbench |
| preparing | Getting started | Workbench |
| investigating | Researching | Research Desk |
| editing | Editing | Workbench |
| running | Running command | Command Console |
| testing | Testing | Test Dungeon |
| needs_input | Needs you | Permission Gate |
| trouble | Trouble | Command Console |
| finished | Done | Shipping Dock |
| idle | Idle | Campfire |

There is no state for a session that has gone. An ended, disconnected or
superseded session leaves the Patch rather than moving to an inactive area, so
the map never holds a character that is not backed by a running process whose
own Claude Code note names that session — and the bridge refuses any event
that cannot name one, so nothing can arrive without a process either.

Leaving is a walk, not a blink. A session that ended, or whose process is
gone, sends its familiar down the south path and out through the gate with a
wave; while it walks the inspector says **Left** and why, the hover nameplate
says LEFT, and it is drawn but no longer counted, seated, listed or
selectable. A superseded session (`/clear`) is removed at once, because the
newcomer wears the same face in the same terminal.

The Workbench is one shared place, not a bench per session. Familiars that
genuinely share a station stagger into stable nearby positions and re-centre when
the others leave.

Internal identifiers remain stable for adapters and tests. They must not appear raw in normal UI.

## Tone rules

- Prefer direct labels over whimsical synonyms in status and alerts.
- Let station names, character behavior, and environmental animation provide personality.
- Say “Needs you,” not “blocked,” when human input is the known requirement.
- Say “Trouble,” not “failed,” because a tool failure may be recoverable.
- Say “Done” when the agent stopped working and handed the turn back. No provider
  reports anything stronger for a foreground session, so the end of a turn is the
  strongest completion signal that exists.
- Say “Idle” when a Done session has gone quiet for long enough that it is no
  longer worth your eye. Idle is a fact about elapsed time, never about the agent.
- Never infer disconnected from silence alone; process identity decides that.
- Avoid productivity scores, streaks, ranks, urgency theater, and emotional punishment.

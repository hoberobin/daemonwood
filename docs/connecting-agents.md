# Connecting agents

## One command

```bash
npm start            # from a clone; `npx --yes <package-name>` once published
```

The launcher (`bin/daemonwood.mjs` → `scripts/cli.mjs` → `scripts/runtime.mjs`)
stages a durable runtime in `~/.daemonwood/versions/<build>/`, writes stable hook
launchers to `~/.daemonwood/hooks/`, points Claude Code's user settings at them,
and starts a background service on `127.0.0.1:4173` (or another free port,
recorded in `~/.daemonwood/runtime.json`, which every sender reads). Run it
again any time; it is idempotent, reuses a healthy service, and rewrites
handlers whose Node path has moved.

```bash
node bin/daemonwood.mjs status      # service, Claude Code, hooks, delivery
node bin/daemonwood.mjs repair      # rewrite our handlers and restart
node bin/daemonwood.mjs stop        # pause until the next explicit launch
node bin/daemonwood.mjs uninstall   # remove only Daemonwood's handlers and runtime
```

`connect` and `disconnect` remain as aliases for launch and uninstall. If the
service is not running when a hook fires, the hook hands its already-sanitized
event to a short-lived helper that starts the service and delivers it, so a
reboot never needs a manual restart. `stop` is respected: a paused Daemonwood stays
down.

From the source checkout, `node scripts/connect.mjs /absolute/path/to/project`
still installs hooks into a single project's `.claude/settings.local.json` for
development. (`npm run connect` is now the launcher and takes no path.)

`scripts/claude-setup.mjs` is the source of truth for what a hook entry looks
like and how it is written, read and removed.

## Which terminal is which

Six terminals, six familiars, and no way to tell Moss from Fern by looking at
the tabs — so the connection is drawn from both ends.

**On the map.** Everywhere the page points you at a session, it says which
terminal, in one wording, from one module (`src/session-address.js`):

| Where | What it says |
| --- | --- |
| The alert in the top bar | `Moss needs you · VS Code ttys003 · web-app` |
| The next step under a waiting familiar | `Answer it in VS Code ttys003 · web-app.` |
| Hovering a familiar | its name and state, and under them `ttys003 · web-app` |
| The inspector's first rows | Terminal `ttys003 · VS Code`, then Project |

The tty comes from the process table the bridge already checks; the terminal
app is what the hook found in its environment. The tty is the part you can
verify: type `tty` in the terminal you are wondering about.

A **Session** row appears only when the session has a name somebody chose —
`/rename` in the terminal, or a name Claude Code or a hook wrote for it. The
fallback Claude Code gives every session (`web-app-6c`: the project's slug
plus two characters) is not shown, because it is the project row again with
noise on the end; Claude Code's own session list hides it too. The note says
which kind it is (`nameSource`), and a rename reaches the inspector within a
couple of seconds.

**In the terminal.** The launcher also installs a status line,
so every session's status line begins with its familiar — `Lumen luna-moth
tester │` — in front of whatever status line was configured before. The
wrapper asks the bridge which familiar the session is; if the bridge is down
or has not seen the session yet, the previous status line prints alone. The
previous configuration is carried inside the wrapper's own command, so
`uninstall` restores it exactly. If you already have a custom status line it
is left alone unless you pass `--wrap-statusline`; `--no-statusline` skips the
status line entirely.

The familiar itself is chosen by the bridge when a session is admitted, so
the name on the map and the name in the terminal are one decision. Nothing a
sender posts can pick one. Every session has one familiar it prefers, fixed
by its id, and takes the next one along the family only while its own is
worn by a live session — and the bridge remembers each session's face in
`~/.daemonwood/familiars.json`, so restarting the bridge never renames anyone.
(It did once: the author's session was Moss in the terminal all morning and
Nettle on the map after a restart. That file is why it cannot happen again.)

**Is it connected at all?** The top bar says so. The bridge runs the same
check as `status` — the hooks in the Claude Code user settings and the status
line — and reports it on every heartbeat. The button reads **Ready for Claude
Code** once hooks are installed, **Receiving Claude events** with a green dot
once a hook event has actually arrived, and **Daemonwood needs a quick repair**
or **Claude Code hooks are disabled** when something must change. It steps out
of the corner once nothing needs doing; `C` still opens the dialog, which gives
the numbers and the exact repair command for this install.

## Why there is no trust step

Claude Code reads hooks from exactly three files — `~/.claude/settings.json`,
a project's `.claude/settings.json` and a project's `.claude/settings.local.json`
— and applies them without an approval prompt. One install in the user file
covers every project you will ever open, and there is no per-project matrix.
That is why it is the fastest way to get live data on the map.

Sessions already open when you connect do not have to wait for their hooks:
the bridge reads Claude Code's own note about each running session and puts
it on the map at once, with the state Claude Code records for it. Their hooks
load when Claude Code reloads its settings, or at the next session.

Two consequences worth knowing:

- **Reinstalling rewrites the handlers rather than preserving them.** A `node`
  binary that moved is repaired instead of being counted as configured while
  silently failing. `status` flags a hook whose Node path is outdated.
- **A hook that writes into a `~/.claude` nothing reads is a silent no-op.** The
  installer checks whether Claude Code is actually present and says so plainly
  rather than reporting a connection you do not have.

## What each hook means on the map

Daemonwood subscribes to twelve Claude Code events. `hooks/normalize-claude-event.js`
translates them; nothing else in the system knows Claude exists.

| Claude Code event | Becomes | Where the familiar goes |
| --- | --- | --- |
| `SessionStart` | `session_started` | arrives at the Workbench |
| `UserPromptSubmit` | `prompt_submitted` | Getting started, at the Workbench |
| `PreToolUse` — Read, Grep, Glob, WebFetch, WebSearch | `tool_started` · read | Researching, at the Research Desk |
| `PreToolUse` — Edit, Write, NotebookEdit | `tool_started` · edit | Editing, at the Workbench |
| `PreToolUse` — Bash running a recognized test command | `tool_started` · test | Testing, at the Test Dungeon |
| `PreToolUse` — any other tool | `tool_started` · command | Running command, at the Command Console |
| `PermissionRequest` | `needs_input` | Needs you, at the Permission Gate |
| `PermissionDenied` | `failure` | Trouble — auto mode's classifier refused a tool call; nobody is being asked anything |
| `Notification` — permission, needs-input, elicitation | `needs_input` | Needs you, at the Permission Gate |
| `Notification` — `idle_prompt` | `stopped` | Done, at the Shipping Dock |
| `Notification` — `agent_completed` | `completed` | Done, at the Shipping Dock |
| `SubagentStart` / `SubagentStop` | helper count changes | helpers never move or rename the parent |
| `Stop` | `stopped` | Done, at the Shipping Dock |
| `StopFailure`, `PostToolUseFailure` | `failure` | Trouble, where it stands |
| `SessionEnd` | `session_ended` | leaves the wood |

Two traps worth naming. Every hook fired inside a subagent carries `agent_id`
and `agent_type`, and the session's own hooks carry neither: the adapter drops
a helper's tool activity, failures and stops on the floor, keeps only its
`SubagentStart`/`SubagentStop` and any permission dialog, and never lets
`agent_type` become the familiar's name. And `TaskCreated`/`TaskCompleted` are
not subscribed to at all — they fire when the session's own task list changes
(`TaskCreate`, `TaskUpdate`), and counting them once showed five helpers on a
session that had none.

No provider has a "task finished" hook distinct from the end of a turn, so the
end of a turn is what **Done** means: the agent stopped working and the next
move is yours. **Idle** is not an event at all — a session that has been Done for
five minutes walks to the Campfire on its own, so "just finished, go look" and
"nothing has happened here for a while" stay distinguishable at a glance.

## Trust

### What it takes to stand on the map

Two proofs, because the first one alone is not enough:

1. **A live process.** The event names a pid and its start time, and the
   bridge checks both against `ps` itself rather than believing the payload.
2. **Claude Code's own word that this process hosts this session.** Claude
   Code writes a note per running process, `~/.claude/sessions/<pid>.json`,
   the second the process starts, naming the session it hosts. The bridge
   reads the note — never the transcript — and what the note says about a pid
   outranks what any sender says. A note whose recorded start time does not
   match the process's is a note left by an earlier life of that pid, and
   counts for nothing.

The second exists because the first was forged. A sender that reads `ps` can
stamp the pids of four sessions you really are running onto four sessions you
are not, and every pid check passes: four invented familiars, one of them
standing at the Permission Gate asking for something nobody could grant. A pid
proves a process, never a session. The note is what a borrowed pid cannot
answer: it names one session, and an event for any other is refused.

The transcript ledger (`~/.claude/projects/*/<session id>.jsonl`) was the
second proof before the note. It is only the fallback now, for a process with
no usable note: a transcript appears at the first prompt, which can be minutes
after `SessionStart`, and holding a new session to it refused that session's
first events every time.

`/clear` is the one honest way a process changes session. The note moves to
the new id; the bridge admits the new session, retires the old one as
`superseded`, and hands the new one the old one's familiar — same terminal,
same face.

A probe that fails proves nothing either way: an unreadable `ps`, an
unreadable note directory or an unreadable ledger admits the event and
removes nobody.

### What Claude Code's note corrects

The note also records `status` — `waiting` while a dialog is open, `busy`
while the session works, `idle` when the turn is yours — and when it last
changed. Hooks say the same things, but there are gaps only the note closes:

- **A permission is granted.** No hook fires until the approved tool finishes,
  so the map used to say *Needs you* for the whole run of a long command at a
  prompt nobody was waiting behind. The note flips to `busy` as the dialog
  closes, and within two seconds the familiar is back at the station it left.
- **A turn is interrupted.** Escape runs no `Stop` hook. The note says `idle`;
  the familiar goes to the Shipping Dock as Done.
- **A hook is lost** — the bridge was down for a second, a hook overran its
  timeout — and the map would otherwise keep the last state it heard.

A correction is an event of the bridge's own, stamped with the time the note
changed, and only ever issued when the note is newer than the last event the
session sent. A hook that arrives later still wins.

### Sessions that were already running

Every sweep also looks for notes whose process is running and whose session
is not on the map — opened before the bridge, before the hooks, or while the
bridge was restarting — and admits them with the state the note records. So
restarting Daemonwood never shows an empty clearing over a machine with three
sessions on it. A session that has just left is not brought back by the note
its exiting process leaves behind for a moment.

### When a session disappears

A session is removed only on proof: its own `SessionEnd`, its owning process
being gone, its process's note naming a different session (`/clear`), or —
for a session with no note — the ledger disowning it. Claude Code processes that are killed
abruptly never get to run `SessionEnd`, so Daemonwood records each session's PID
plus its process start time and reaps it within about two seconds. Silence
removes nobody — a session quiet for a week but demonstrably running is still
running, and the freshness line already says how long it has been.

The event stream beats every fifteen seconds and the page watches for it, so a
connection that is open but dead cannot pass for a quiet workshop.

## Privacy and failure behavior

The adapter sends only session ID, source, project-folder alias, coarse activity
category, helper lifecycle, timestamp, and the session's title. It does not send
prompts, responses, source code, raw commands, tool input or output, transcripts,
secrets, or absolute project paths.

The title is the one line Claude Code itself puts on the terminal tab: a short
`ai-title` it generates after the first prompt, or the name you gave with
`/rename`. The hook reads the last 64 KB of the session's own transcript, keeps
only that entry (80 characters at most), and sends it to the local bridge with
the event; nothing else in the transcript is parsed or leaves the hook. The
bridge itself still never opens a transcript. Set `DAEMONWOOD_SESSION_TITLES=0` in
Claude Code's environment to leave titles out.

Hooks use a short timeout and fail open. If Daemonwood is closed, Claude Code
continues normally. Hooks are observational; they never approve, deny, rewrite,
continue, or stop agent work.

## Any other agent

The world knows about normalized lifecycle events, not providers. POST the
payload described in [`protocol.md`](protocol.md) to:

```text
http://127.0.0.1:4173/api/events
```

Claude Code's own adapter is under a hundred lines and has no privileges the
endpoint does not give everyone. What the endpoint gives everyone is not much:
it admits an event only from a live `claude` process whose own note names the
session, so another agent joins today by running under one. Widening
that is a real piece of work — the proof a non-Claude agent would offer has to
be as hard to forge as this one, and "trust the payload" is what the gate exists
to refuse.

## Debugging

- `http://127.0.0.1:4173/api/health` reports bridge, browser-client, session,
  and event counts.
- `status` verifies the hooks and bridge availability in one pass.
- `refusedEvents` and `lastRefusal` in that same health payload are the first
  thing to read when the map is emptier than the machine is. A refusal means an
  event arrived that could not name a live Claude Code process, and the reason
  says whether it was a forgery or your own session going unrecognized.
- **The event console**, opened with `` ` ``, shows the sanitized events the
  browser actually received.
- Refreshing the page should restore current sessions from the bridge snapshot.

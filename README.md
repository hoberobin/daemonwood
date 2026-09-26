# The Patch — v0.15 beta

Your coding agents, as pixel familiars in a Pacific Northwest workshop.

The Patch renders live, sanitized lifecycle events from real Claude Code
sessions as characters moving between stations on a hand-drawn map. A familiar
at the Test Dungeon is running tests. One at the Permission Gate is waiting for
you. The map displays the eight sessions that matter most while tracking and
counting every connection.

The core is provider-neutral: any agent that can POST the payload in
[`docs/protocol.md`](docs/protocol.md) appears on the map. Claude Code is the
one adapter that ships.

## Run it

macOS (Linux/WSL beta), Node.js 22 or newer, and Claude Code on `PATH`. No
dependencies to install.

```bash
npm start     # set up, start in the background, open the map
```

That is the whole setup, and it is safe to re-run. It stages a durable runtime
in `~/.the-patch/`, writes The Patch's hooks into Claude Code's user settings
(`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR`), which covers **every
project in that profile at once**, starts a background service and opens the
page. You can close the terminal; nothing refers back to this folder. Sessions
Claude Code is already running appear straight away from its own per-session
notes, and sessions started from now on report each move as it happens. Your
other hooks, permissions and status line are kept.

```bash
npm run status      # service, Claude Code, hooks, delivery
npm run repair      # rewrite The Patch's hooks and restart
npm run stop        # pause until the next launch
npm run disconnect  # uninstall: remove only The Patch's hooks and runtime
npm test            # the automated suite
npm run dev         # serve this checkout in the foreground, for development
```

`--wrap-statusline` puts each session's familiar in front of a custom status
line you already have; `--no-statusline` leaves the status line alone;
`--no-open` skips the browser. Once published, `npx --yes <package-name>` will
do the same from any directory.

New here? [`docs/getting-started.md`](docs/getting-started.md) is the shortest
path from download to a moving familiar.

## How to read the world

The interface is the world. At rest the page is the map, the product name, and
one sign saying whether Claude Code is connected — the bridge checks the hooks
itself and reports it on every heartbeat, so the bar never says "Connect"
beside a familiar that plainly is. An amber alert appears only when a session
actually needs you, and it says where: `Moss needs you · VS Code ttys003 ·
web-app`. There is no roster and no counters — the named familiars are already
on screen, so a list of them is the same information twice. The one number the
bar carries is the count of sessions it is *not* showing, because the
familiars drawn must never be mistaken for every session.

The terminal end of the link says the same thing: the launcher puts each
session's familiar at the front of its Claude Code status line, and a session
keeps its face for life — through bridge restarts, which the map otherwise
survives without a trace. Hover a familiar and the map names it and its
terminal; click it and an inspector rail opens inside the map frame: who it
is, what it is doing, the terminal and project it lives in (`ttys003 · VS
Code`), the name `/rename` gave it if any, the task, and a short trail of
where it has been. It never covers the world — the frame widens by the rail's share and
the renderer insets the map to match, so the world re-fits beside the panel
instead of hiding behind it. On a phone the rail becomes a sheet stacked under
the map, which keeps every pixel of the world.

Controls: click a familiar to inspect, click open ground or press `Esc` to
close, `←`/`→` to step between familiars, and `` ` `` for the raw event console.

The empty world is honest: it shows nothing until a real lifecycle event
arrives. Event freshness is visible without pretending that a quiet agent
disconnected, and terminal sessions can make room for new work without evicting
active agents.

## What is in here

| Path | What it holds |
| --- | --- |
| `index.html`, `server.mjs` | the page, and the dependency-free static + SSE server (`npm run dev`) |
| `src/` | lifecycle state engine, world routing, renderer, design tokens, browser app |
| `src/design/tokens.js` | the one source of record for every colour, type, motion and HUD value |
| `hooks/` | the fail-open Claude Code adapter and status line |
| `bin/the-patch.mjs`, `scripts/cli.mjs` | the CLI: launch, status, repair, stop, uninstall |
| `scripts/runtime.mjs`, `daemon.mjs`, `deliver.mjs` | durable install, background service, cold-start delivery |
| `scripts/claude-setup.mjs`, `local-files.mjs` | what a Patch hook entry is; safe settings edits and locks |
| `scripts/package-files.mjs` | the one payload list shared by npm and the installer |
| `scripts/` (other) | `connect.mjs` (per-project dev install), art export/check/QA, `ui-check.mjs`, `screenshot.mjs` |
| `tests/` | executable product invariants — logic, privacy, routing, map and sprite contracts |
| `assets/map/` | the illustrated runtime plate, the Tiled object map, the graybox layout preview |
| `assets/sprites/` | the ten runtime walk sheets and the atlas contract they share |
| `assets/palette/` | the locked western Oregon environment and signal colours |
| `assets/archive/` | superseded plates and walk sheets, kept for reference, referenced by nothing (not packaged) |
| `docs/` | everything written down — see below |

## Documentation

| Document | What it answers |
| --- | --- |
| [Getting started](docs/getting-started.md) | download to a moving familiar, in five steps |
| [Connecting agents](docs/connecting-agents.md) | how the hooks work, the state mapping, debugging |
| [Protocol](docs/protocol.md) | the provider-neutral event and privacy contract |
| [Project manifest](docs/project-manifest.md) | durable product decisions, status, collaboration protocol |
| [Design system](docs/design-system.md) | how tokens, layers and the HUD language fit together |
| [Art bible](docs/art-bible.md) | canonical PNW visual and animation rules |
| [Terminology](docs/terminology.md) | canonical product nouns, state labels, tone rules |
| [Testing](docs/testing.md) | the automated suite, the live-session gate |
| [Ralph loops](docs/ralph-loops/) | the iteration log: what was found, changed and rejected, per version |
| [References](docs/references/) | preserved concept art, explicitly non-canonical |

## Locked decisions

- Up to eight top-level agent familiars on the map at once (`MAP_FAMILIAR_LIMIT`
  in `src/world-model.js`), sharing one roomy workbench
  and one of each lifecycle station. More sessions than that are still tracked: a
  session that needs you always takes a place, and resting sessions step off
  before working ones do.
- Ten distinct familiar identities rotate through those visible places
  without changing their movement, state, selection, or inspector behavior.
- Fixed one-screen map with no camera scrolling.
- 16×16 logical environment tiles and 42-unit familiar footprints; runtime
  familiar art uses 128px source frames to match the illustrated plate.
- Pointer/keyboard observation; no player-controlled avatar.
- Authored waypoint movement for the first version.
- Western Oregon/Cascadia landscape and materials.
- Test Dungeon, Permission Gate, and Shipping Dock are permanent visual state
  stations.
- Done means the agent stopped working; Idle means it has been Done and quiet for
  five minutes. Ended or disconnected sessions leave the Patch instead of
  lingering in an inactive area.
- A session keeps its familiar for life. Every session prefers one face, fixed
  by its id, yields it only while a live session wears it, and the bridge
  remembers past choices in `~/.the-patch/familiars.json`, so a restart never
  renames a familiar the terminal's status line has been calling Moss all day.
- A session that ends does not blink out. Its familiar turns, walks down to the
  chained gate at the foot of the clearing wearing a waving-hand badge, and
  fades out through it; the panel follows it to the gate and says "Left" and
  why. A `/clear` hand-over is instant, because the same face carries on in
  the same terminal.
- Everywhere the page points at a session it names the terminal — the alert,
  the next step, the hover nameplate, the inspector — in one wording. Claude
  Code's fallback session slug is not shown; only a name somebody chose is.
- Abruptly killed Claude Code processes are detected from their PID plus process
  start time and leave the Patch within about two seconds, even when no
  `SessionEnd` hook can run.
- A familiar stands on the map only for a session Claude Code says it is
  hosting: a live `claude` process, and Claude Code's own note for that process
  naming that session. A sender cannot claim either. `/clear` hands the
  terminal to the new session, which keeps the old one's face.
- Claude Code's note also says whether a session is waiting, busy or idle, and
  the bridge lets it correct the map within two seconds: a granted permission
  stops saying "Needs you", an interrupted turn stops saying "Running".
- Helpers never move or rename the familiar; only a helper's permission dialog
  reaches the map. Task-list changes and auto-mode classifier denials are not
  helpers and are not prompts for you.
- No XP, currency, streaks, productivity scoring, or surveillance mechanics.

## Next production pass

1. Confirm every anchor and collision area in `assets/map/workshop.tmj` (Tiled).
2. Test all ten walk sheets at 2× and 3× scale, including shared-station and
   shared-route spacing.
3. Run the live-session gate in [`docs/testing.md`](docs/testing.md).
4. Review the isolated art harness with `npm run art:qa` and record visual sign-off.
5. Add new station foregrounds only as explicit masks or source crops; do not flatten them into the plate.
6. Inpaint terrain only when an editable map master is available.

Generated scene concepts remain visual references. Familiar source art becomes a
runtime asset only after it is normalized to the shared atlas contract, visually
inspected in the live scene, and covered by the asset tests. The TMJ layout
remains authoritative when a concept image disagrees with station count or
spacing.

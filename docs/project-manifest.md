# The Patch — Project Manifest

Last updated: 2026-09-26  
Current package: v0.15.0-beta.1  
Current gate: real-session comprehension and engagement test

## Product thesis

The Patch turns local coding-agent sessions into visible pixel familiars inside a persistent Pacific Northwest workshop. Each familiar truthfully reflects a session's observable lifecycle so one person can supervise different providers without repeatedly opening every tool.

## Primary value

Within three seconds, the user should know:

1. How many agent sessions are active.
2. What broad state each session is in.
3. Which session needs attention.
4. What recently finished.

## Canonical decisions

- Solo/local product before team or cloud functionality.
- A provider-neutral local event protocol supplies lifecycle events. Claude Code is the one adapter that ships; any other agent joins by POSTing the protocol payload. A Codex adapter was built in v0.10 and has since been removed — `tests/ui-contract.test.js` asserts the interface must not promise it. Its known fragility is recorded in `docs/ralph-loops/v0.10.md`: Codex trust is bound to a hook's exact contents, so any rewrite silently voids it.
- No prompts, source code, raw commands, secrets, or absolute paths are transmitted or stored.
- One top-level session equals one full-size familiar.
- Subagents are small helpers attached to the parent familiar.
- Fixed 32×18 map; 16×16 logical tiles; 512×288 logical resolution. Familiar source frames are 128×128 and render into a 42-unit world footprint to match the illustrated plate's density.
- Four familiars on the map at once, sharing one workbench and one of each lifecycle place. The cap is a drawing limit, never a listening limit: every connected session is kept and counted, a session that needs you always holds a place, resting sessions yield before working ones, and the top bar states how many are not shown.
- No player-controlled avatar in v0.1.
- Western Oregon/Cascadia is the permanent environmental identity.
- The production walk family has ten identities: Moss, Fern, Lumen, Cedar, Alder, Mica, Ripple, Thimble, Spruce, and Nettle. `src/familiars.js` is the runtime catalog for their names, species/roles, and sprite paths.
- Every session prefers one familiar, fixed by its id, and takes the next along the family only while its own is worn by a live session. The bridge remembers each session's face and terminal app in `~/.the-patch/familiars.json`, so a bridge restart never changes a familiar the terminal has been naming all day. Two live sessions never share a face.
- Physical stations communicate state: Research Desk, Workbench, Command Console, Test Dungeon, Permission Gate, Shipping Dock, and Campfire.
- A familiar alone at a station stands on it. Only familiars genuinely sharing a station are staggered, and they re-centre when the others leave. The campfire is the exception and declares its own seats, because its anchor is a bonfire rather than standing room.
- Shipping Dock means the agent stopped working; Campfire means it has been quiet there for five minutes. An ended or disconnected session's familiar walks out through the south gate with a wave and fades (`AgentController.leave`, `src/familiar-ledger.js` untouched); it is drawn while it walks but is no longer a session. Superseded, unproven and reset removals are instant.
- No XP, currency, streaks, productivity scoring, or surveillance mechanics.
- Onboarding is one command. `npm start` (later `npx --yes <package>`) stages a durable runtime in `~/.the-patch/`, writes Claude Code's hooks into the user settings (`~/.claude/settings.json` or `$CLAUDE_CONFIG_DIR`) — there is no user-level `settings.local.json` — which covers every project at once and needs no approval step, then starts a background service and opens the map. `scripts/connect.mjs <project>` remains a checkout-only per-project install.
- Claude Code's per-process session note (`~/.claude/sessions/<pid>.json`) is the bridge's word on which session a process hosts and whether it is waiting, busy or idle. It admits sessions before their transcript exists, refuses a borrowed pid, retires the old session on `/clear`, corrects the map when hooks cannot, and puts already-running sessions on the map at startup.
- Agent trust boundaries are never forged. Where an agent requires the user's approval for hooks, that approval is the user's to give; The Patch may read whether it was given and must never write it.
- At rest the interface is the world, the product name, and one sign saying whether Claude Code is connected: the bridge runs the installer's own check and reports it on every heartbeat. An alert appears only when a session needs you, and everywhere the page points at a session — the alert, the next step, the hover nameplate, the inspector — it names the terminal and project in one wording from `src/session-address.js`. Claude Code's fallback session slug is never shown; a Session row exists only for a name somebody chose. Clicking a familiar opens an inspector rail inside the map frame; the frame widens by the rail's share and the renderer insets the world to match, so the panel takes room without taking cover. On narrow screens the rail stacks under the map instead.

## Canonical files

| File | Authority |
| --- | --- |
| `docs/art-bible.md` | visual rules and art definition of done |
| `assets/map/workshop.tmj` | exact map topology, anchors, and collisions |
| `assets/map/workshop-plate-v3.png` | illustrated runtime map plate |
| `assets/map/workshop-graybox.svg` | editable layout preview |
| `assets/palette/pnw-palette.json` | production environment and signal colors |
| `assets/sprites/moss-walk-v0.3.png` | high-density Moss runtime movement sheet |
| `assets/sprites/fern-walk-v0.2.png` | high-density Fern runtime movement sheet |
| `assets/sprites/lumen-walk-v0.2.png` | high-density Lumen runtime movement sheet |
| `assets/sprites/cedar-walk-v0.2.png` | high-density Cedar runtime movement sheet |
| `assets/sprites/{alder,mica,ripple,thimble,spruce,nettle}-walk-v0.1.png` | six additional high-density runtime movement sheets |
| `src/familiars.js` | canonical familiar identity and sprite catalog |
| `assets/sprites/familiar-atlas-v1.json` | generated mirror of the 24-frame familiar contract, source hashes, pivots, and exports |
| `src/design/tokens.js` | every shared colour, type, motion and HUD value |
| `docs/design-system.md` | how the tokens, layers and HUD language fit together |
| `src/effects.js` | firelight; draws under everything meaningful |
| `src/state-machine.js` | lifecycle mapping and privacy sanitizer |
| `src/world-model.js` | station destinations and authored routing |
| `docs/protocol.md` | provider-neutral adapter and privacy contract |
| `docs/connecting-agents.md` | setup and debugging path |
| `tests/*.test.js` | executable product invariants |
| `docs/testing.md` | the automated suite and the live session gate |

When concept art conflicts with a canonical file, the canonical file wins.

## Milestones

### Complete

- Product thesis and scope locked.
- PNW visual direction locked.
- Exact workshop topology created.
- Map anchors, station footprints, and basic collisions encoded.
- Palette encoded.
- Ten coordinated familiar walk sheets encoded at 128×128 source pixels per frame and normalized to a shared 42-unit world footprint.
- Familiar assignment and sprite loading consume one extensible catalog, with asset tests preventing the runtime and art manifest from drifting apart.
- Dependency-free browser prototype created.
- Sanitized lifecycle state engine created.
- Authored waypoint routing created.
- Automated logic and asset-contract tests created.
- Four-provider registry, local HTTP/SSE bridge, and Claude Code adapter created.
- Hook, bridge, protocol, privacy, routing, and asset tests pass without a live agent.
- Mobile scan hierarchy, persistent attention banner, selected-agent highlight, and progressive debug disclosure created.
- Honest empty state and in-product connection guide created.
- Event freshness separated from lifecycle and bridge status.
- Deterministic terminal-session eviction prevents old work from blocking new agents.
- Session drawer replaced by an in-map inspector rail; roster and counters removed as duplicates of the map, raw event log moved behind the `` ` `` console, and empty fields dropped instead of printed as "Not provided".
- Core work states have distinct, contract-tested physical destinations.
- Travel and arrival are communicated separately and update immediately.
- Location is the primary status channel; color and text are reinforcement.
- Protocol states and user-facing language are separated by a tested copy layer.
- Operational nouns and playful world nouns have distinct documented roles.
- State-specific familiar cues add life without scores, streaks, or surveillance.
- Reversible project-local Claude installer, connection doctor, and uninstaller created.
- Bridge health reports start time, event count, and last-event time.
- The end of a turn reaches the Shipping Dock: it is the only completion signal any provider actually reports for a foreground session. Only elapsed silence reaches the Campfire.
- Codex adapter built (v0.10) and later removed; the interface is contract-tested not to promise it.
- Subagent-scoped tool activity cannot move or rename the parent familiar.
- Provider-qualified session identity prevents cross-provider collisions.
- Late events cannot rewind a newer visible state.
- Safe in-memory session snapshots restore the world after browser reconnects and refreshes.
- Shared-station and waypoint offsets keep concurrent familiars individually visible without multiplying locations.
- Ended and disconnected sessions are removed from both the live world and reconnect snapshots.
- Every lifecycle area uses the same code-rendered label treatment; Research is named explicitly rather than called Archive.

- A familiar stands on the map only on proof of two separate things: that a process is running, and that Claude Code says that process hosts the session that claims it. A live pid proves a process and nothing else — a sender that reads `ps` can stamp real pids onto invented sessions, which is how the seeded demo cast walked back on. So the bridge asks Claude Code's own note for the process, and holds one pid to one session. The transcript ledger (`~/.claude/projects/*/<session id>.jsonl`, never opened, only counted) is the fallback for a process without a note; it used to be the proof, and refused every new session's first events because a transcript appears at the first prompt.
- A session is removed only on proof: its own end event, its owning process being gone, its process's note naming another session, or — without a note — the ledger disowning it. A probe that cannot read `ps`, the notes or the ledger proves nothing and removes nobody.
- Claude Code's note corrects the map when hooks cannot: a granted permission, an interrupted turn, a lost hook. A correction is stamped with the note's own change time and never outranks a later hook.
- Sessions already running are discovered from their notes at startup and on every sweep, so a restarted bridge is never emptier than the machine.
- A helper's activity never moves or renames its parent. Task-list hooks are not helpers; auto-mode classifier denials are Trouble, not a prompt for you.
- The stream beats every fifteen seconds and the page watches for it, so a connection that is open but dead cannot pass for a quiet workshop.
- Reinstalling hooks reports whether it changed them, because a rewrite is exactly what voids an agent's recorded trust in a hook.
- Hook handlers are rewritten rather than preserved on reinstall, so a moved `node` binary is repaired instead of counted as configured while failing, and handlers for events no longer subscribed to are stripped wherever they linger.

- One source of record for the palette. Canvas code may not contain a colour literal, and a test fails if the art JSON, the stylesheet and the renderer ever disagree.
- Firelight is the only ambient effect, and draws strictly beneath the placards and familiars. Mist, a light grade and a vignette were tried and removed: atmosphere in a screenshot, noise in a tool kept open all day.
- Decoration animates an order of magnitude slower than any agent state, and reduced motion freezes the fire without putting it out.
- Ambient layout is deterministic: the world looks the same on every reload.
- The map's end of the terminal link matches the terminal's: the alert says where to go, the next step names the window, hovering names the terminal, the inspector leads with it, and the top bar says whether Claude Code is connected at all. A familiar's face is remembered across bridge restarts, because the face is the one word both ends share.
- Every label in the interface is built the way the world builds its signs: a stained cedar plank in a darker batten, brass rivets, a soot edge. The tag above a familiar, the station placards, the detail panel, the dialog and the controls all share one recipe.

### Current

- Dogfood Claude Code with a real local session at desktop and narrow responsive widths.
- Evaluate whether physical travel improves comprehension or introduces delay.
- Dogfood the new familiar family after movement, scale, and silhouette feedback.

### Next

1. Resolve findings from the live session gate in `docs/testing.md`.
2. Review and sign off the four-frame walk cycles in the isolated art harness (`npm run art:qa`).
3. Draw idle, editing, testing, needs-input, finish, and parcel-carry animations.
4. Decide whether a second provider adapter is worth its upgrade cost.
5. Decide whether return-to-source links belong in the next prototype.

## Versioning protocol

- Never overwrite a released package archive.
- Increment the package version after each accepted production gate.
- Store editable source and runtime exports together.
- Update this manifest whenever a decision becomes canonical.
- Keep generated scene concepts under `docs/references/`. Generated familiar art may become a runtime sprite only after atlas normalization, density matching, live-scene inspection, and asset-contract coverage.
- Record rejected directions briefly so they are not accidentally reintroduced.

## Collaboration protocol

For each iteration:

1. State the current production gate.
2. Change only the assets or system needed for that gate.
3. Render and inspect the result.
4. Identify defects honestly.
5. Update canonical files and this manifest.
6. Package a new restorable checkpoint.
7. Name the next gate.

The user does not need to restate the complete concept. Refer to this manifest and the art bible as the authoritative project context.

## Explicitly deferred

- Team multiplayer
- Accounts and cloud persistence
- GitHub, ClickUp, Slack, and Intercom integrations
- Map editor
- Additional biomes
- Additional familiar species beyond the ten-character production family
- Starting or controlling agents from the world
- Productivity analytics

# Testing

Two layers, cheapest first: the automated suite and the live session gate. Only
the second one can tell you whether the product works.

There is deliberately nothing in between. A simulated session used to sit here,
and it earned its keep right up until the day a seeded cast of four familiars —
one of them holding a permission prompt — spent an afternoon on a live map with
no agent behind any of them. The bridge now refuses events that cannot name a
running Claude Code process, which makes a fake session impossible to stage and
this layer impossible to write. Halve a problem with the event console and
`/api/health` instead.

## 1. Automated suite

```bash
npm test
```

No dependencies, no network, no agent. The suite covers lifecycle mapping,
privacy stripping, Claude event normalization, reversible hook installation,
HTTP ingestion, bridge diagnostics and heartbeat, the install check the top
bar reports, stable familiar identity across bridge restarts, the session
address the alert and inspector share, the walk out through the gate when a
session ends, process liveness and session
removal, event refusal, state destinations, route availability, deterministic arrival, safe
rerouting, exact map dimensions, station inventory, design-token agreement
across the palette JSON / stylesheet / renderer, and the sprite-atlas contract.

These are product invariants, not unit-test decoration. A failure here means a
locked decision was broken.

## 2. Live session gate

The current gate is one truthful, enjoyable Claude Code session — not more
integrations and not more decorative scope.

### Setup

1. `npm test`, then `npm start` (it installs, starts the service and opens the map).
2. If no browser opened, open the address it printed.
3. Start a Claude Code session in a disposable or low-risk repository.

### Give it one observable task

A real task requiring reading, one edit, and a test or validation command. For a
throwaway repository:

> Inspect the project, make one small documentation improvement, run the
> smallest relevant validation command, and summarize what changed.

Do not weaken permissions to manufacture a Permission Gate event. It should
appear only when the agent genuinely requests approval.

### Observe

Keep Daemonwood visible but avoid opening the agent's terminal for 30 seconds at
a time. Ask:

1. Can I identify broad activity within three seconds?
2. Can I tell whether the session needs me?
3. Does movement help, or does it delay the answer?
4. Does the page still show the correct session after refresh?
5. Is the last-update signal trustworthy?
6. Would I leave this open during real work?

Record **yes**, **partly**, or **no**, plus one sentence for each.

### Expected semantics

The Research Desk, Workbench, Command Console and Test Dungeon represent
observed local tool activity. The Permission Gate requires an actual approval
request. The end of a turn reaches the **Shipping Dock** and means *Done* — the
agent stopped working, the next move is yours — not that a task is complete.
Only five minutes of silence after that reaches the Campfire as **Idle**.

Closing the source session removes its familiar. A killed process removes it
within about two seconds. There is no sleeping or offline holding area.

### Reliability checks

1. Refresh the browser mid-session; the familiar should return from the bridge
   snapshot.
2. Spawn a subagent if the task naturally benefits from one. The helper count
   may change, but child tool calls must not move or rename the parent.
3. Stop Daemonwood, run another agent action, and confirm the agent continues
   without hook errors blocking work.
4. Restart Daemonwood. Every running session is back within two seconds,
   before any turn, with the state Claude Code records for it.
4a. Approve a permission for a command that runs a while; confirm *Needs you*
   clears within two seconds of approving, not when the command ends.
4b. Interrupt a turn with Escape; confirm the familiar reaches the Shipping
   Dock as Done within two seconds.
4c. Run `/clear`; confirm the same familiar stays, and `/api/health` counts no
   refusal.
5. Kill an agent process outright and confirm its familiar leaves within a few
   seconds without a `SessionEnd` event.
6. Open the event console with `` ` `` and confirm it contains no prompt,
   response, code, command, tool arguments, transcript path, or absolute project
   path.

### Pass condition

The gate passes when the live session:

- appears after `npm start` with no manual JSON editing and no server terminal;
- moves through at least three truthful places;
- survives a browser refresh;
- does not confuse helper activity with the parent;
- never blocks the agent when Daemonwood is unavailable;
- exposes no private work content; and
- earns **yes** or **partly** for "Would I leave this open?"

If the final answer is **no**, fix that reason before adding providers, company
integrations, species, or progression systems.

## Comprehension checks

Worth re-running whenever the world or its language changes.

**Spatial.** Before reading the inspector, identify the agent's broad activity
from where its familiar is standing. Confirm the inspector says *Heading to…*
during travel and only names the station after arrival. Confirm a fast event
interrupting travel reroutes the familiar through an authored waypoint without
crossing structures. Colour and status text should help, but location alone
should distinguish the core states.

**Language.** Confirm no raw identifier such as `needs_input` appears in normal
UI. Ask a new viewer to explain agent, source, session, familiar, helper and
station after one minute. Confirm *Researching*, *Getting started*, *Needs you*,
*Done* and *Idle* match the provider evidence. Confirm nothing ranks agents,
rewards speed, counts streaks, or punishes inactivity.

**Multi-session.** Run two or more sessions at once in different projects.
Confirm familiars sharing a station stagger into stable nearby positions and
re-centre when the others leave, and that the top bar states how many sessions
are connected but not shown.

**Narrow width.** At phone width, confirm you can answer "who needs me?" without
opening the inspector, that the attention banner selects the right familiar, and
that the inspector becomes a sheet stacked under the map rather than covering
it.

**First run.** With nothing connected, confirm the world says the clearing is
quiet and says it is ready for Claude Code — it is served by an installed
Daemonwood, so it offers no setup command, and it must not claim a session exists.

## Known limitations

- Helpers are visual placeholders.
- Activity animations other than walking are temporary labels and effects.
- The production PNW tileset has not replaced the illustrated plate's detail
  pass.
- Return-to-source actions are not implemented.
- Claude Code is the only adapter that ships; any other agent must POST the
  protocol payload itself.

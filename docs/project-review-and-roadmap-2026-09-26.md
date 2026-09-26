**The Patch: project review and expansion plan**  
Reviewed September 26, 2026 · current package: 0.14.0

**Recommendation**

Build the next release around one complete workflow: notice a session that needs attention, understand its state, find the correct terminal, and return to your work. Preserve the Pacific Northwest workshop and familiars. Invest next in trustworthy status, access to every session, accessibility, and an easier daily launch experience.

The working assumption is a polished local product for individual developers, initially using Claude Code. This follows the project's stated solo/local scope. Public distribution is a later gate; commercial demand has not been established.

**What I reviewed and verified**

I reviewed the product manifest, setup and protocol documentation, iteration history, browser application, lifecycle and session logic, bridge, hook adapter, installer, renderer, art pipeline, and tests. I researched comparable products, current Claude Code integration documentation, calm technology, and relevant accessibility guidance.

- `npm test`: **160 passed, zero failures**.
- `npm run art:check`: **passed**, including 240 familiar frames, eight helper frames, and seven station crops.
- Ran an additional local server on port 4187 and inspected the running interface in isolated Chrome pages at 1440×900, 1024×768, and 430×932, including the inspector and connection dialog. The captures reported no browser errors.
- Observed sessions discovered from existing local session notes. I did not install hooks, issue work to those sessions, or run the full real-session lifecycle gate. The alternate port did not establish that the existing hooks were delivering events to this review server.
- Reproduced five waiting sessions producing four visible records and one hidden record using an isolated in-memory registry. Confirmed that event sanitization drops `provider`, and that familiar assignment reuses an identity once all ten are occupied.
- Reproduced keyboard focus loss in the running browser: a session button received focus while clipped by `inset(50%)`; after the routine UI refresh, that node was disconnected and focus had returned to `BODY`.
- Inspected existing isolated art QA evidence, including four familiars sharing the Permission Gate. That evidence is useful visual coverage, not a user-comprehension result.

This is an expert review with targeted checks, not a completed usability study, comprehensive security audit, or platform certification. Recommendations below distinguish observed behavior from hypotheses to validate.

**Product assessment**

The strongest intended user is someone supervising roughly two to six local coding sessions across projects or worktrees, who repeatedly checks terminals to discover whether an agent is still working or waiting. That segment is a hypothesis worth testing before expanding to teams or remote work.

The useful promise is: “Know which local agent needs you, and where to go, at a glance.” Your visual world gives this promise a memorable form. The workshop's permanent stations, distinct silhouettes, restrained interface, and stable familiar identities are coherent. The status-line identity is particularly useful because it connects the map to the source of work.

Several engineering decisions deserve preservation: separating freshness from lifecycle state, distinguishing a stopped turn from verified task success, ignoring helper tool activity when deriving the parent's state, restoring snapshots after reconnects, and letting hooks fail without stopping agent work. The dependency-free runtime is appropriate at this stage. A framework rewrite would add migration work without solving the current product problems.

The main risk is adoption after the novelty wears off. A pleasing display earns a first visit; reliably catching a waiting session and locating it earns a permanent place in the workflow. Measure that second outcome.

**What external research changes about the strategy**

Pixel Agents already describes a VS Code extension and standalone CLI, live activity characters, permission indicators, optional sounds, and layout customization. Animated coding-agent characters alone therefore offer limited differentiation. These are the project's own feature claims; I did not benchmark its reliability. [Pixel Agents repository](https://github.com/pixel-agents-hq/pixel-agents)

AgentRoom describes a broader desktop product with project filtering, multiple providers, transcript search, and an “Open in Terminal” flow. That demonstrates an adjacent expansion path, but transcript indexing would materially change The Patch's privacy boundary and maintenance burden. [AgentRoom repository](https://github.com/liuyixin-louis/agentroom)

My inference is that The Patch's strongest position is a calm, local companion with legible exceptions and dependable handoff to the source terminal. Calm technology's emphasis on peripheral awareness and minimal attention supports reserving prominent alerts for actionable changes. It does not establish that this particular map is more effective than a compact list; that needs testing. [Calm Tech Institute principles](https://www.calmtech.institute/calm-tech-principles)

Claude's documented hook surface distinguishes permission requests, turn stops, failures, and notifications; some notifications have timing and version qualifications. Record supported Claude versions and test the exact lifecycle semantics you depend on. I found no public contract for the per-process session-note schema in the hook reference reviewed, so treat those notes as a compatibility-sensitive dependency unless an official contract is identified. [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)

**Highest-priority findings**

| Priority | Evidence in this project | User impact | Recommended change |
| --- | --- | --- | --- |
| P0 | `src/agent-registry.js:129` takes the first four ranked sessions. `src/app.js:213` renders a noninteractive hidden count; `:376` selects only the first visible waiting session. | Five simultaneous waiting sessions cannot all appear, and hidden sessions have no detail-selection path. | Turn the existing overflow indicator into an accessible session picker. Provide a complete attention queue and a way to inspect any session while retaining four map places. |
| P0 | `src/app.js:312` treats the installed hook count as “connected”; `server.mjs` checks global configuration. Discovery also operates independently of hook installation. | Installed hooks can look equivalent to working event delivery. Project-local configuration and all-project discovery are not clearly distinguished. | Separate bridge availability, installation scope, session discovery, and receipt of real hook events. Present a plain-language status with details on demand. |
| P0 | The canvas has keyboard support, but focusable buttons sit inside clipped `.sr-only` content, and `renderUI()` replaces those buttons on every render. | Sighted keyboard users can enter invisible focus stops; routine updates can remove the focused node. | Keep stable session DOM nodes, expose a visible equivalent when focused, preserve focus during updates, and announce newly actionable sessions even when nothing is selected. |
| P1 | The inspector supplies next-step text but no return-to-source action; terminal identity can be incomplete for discovered sessions. | The map identifies a problem but leaves the user to search for the source window. | Always provide the best available source address. Start with copying it; add a verified focus action for one terminal/editor environment. |
| P1 | The desktop inspector overlays the map. Edge markers are drawn by `src/renderer.js:234`, but pointer selection in `src/app.js` still uses world positions. | Covered sessions have a visual proxy without a matching pointer interaction; identical state icons can be ambiguous. | Make edge markers selectable, with familiar identity and hover/focus text, using the same geometry for drawing and hit testing. |
| P1 | At 430px, the full map is preserved but station signs and activity glyphs become very small. | A responsive layout does not guarantee a readable operational view. | Offer a compact text-and-portrait view for narrow windows, and test a discoverable station legend. Keep the existing stacked inspector. |
| P1 | `sanitizeHookEvent()` drops `provider`; admission requires a Claude process and Claude session evidence. | The README and protocol overstate current provider support. | Describe the release as Claude-only now. Before adding an adapter, introduce a real provider verification boundary and provider-qualified identity. |
| P1 | README, manifest, iteration logs, and code disagree about the inspector, art status, counts, and release version. | Future work can redo completed features or preserve obsolete requirements. | Reconcile the current specification and release checklist before planning another art or adapter pass. |

P0 means required for a dependable external pilot; P1 follows or accompanies that pilot. These are product priorities, not security severity ratings.

The overflow change intentionally revisits the “no roster” decision only when the map cannot provide the information. A closed-by-default picker accessed through the existing count preserves the quiet resting interface. The revised promise should be “Every waiting session is reachable,” because four places cannot guarantee that every waiting session is drawn.

There are two other capacity boundaries to document: the frontend drops records beyond its default ceiling of 64, and ten familiar types cannot remain globally unique across eleven live sessions. Either publish a supported limit or add secondary identity such as a short session label. Do not silently equate a familiar face with a unique session at every scale.

**UX and UI direction**

Keep the workshop, large character silhouettes, restrained top bar, and existing state color/glyph reinforcement. The shared Permission Gate art sample reads as a group of distinct characters; the next question is whether people can identify the right project and terminal quickly. More scenery is unlikely to answer that.

Make the interaction sequence explicit: attention cue → relevant session → source address/action. For multiple alerts, open a small queue ordered by actionable urgency and waiting duration. Include familiar portrait, project/session label, state, and terminal. Acknowledging or viewing an item must not clear the underlying waiting condition; only source evidence should do that.

Test “Turn ended” or “Ready for review” as alternatives to “Done.” The current inspector correctly explains the semantics, but the dock's label and parcel metaphor may still imply task success. This is a comprehension hypothesis, not a request to change the lifecycle engine. Keep test activity separate from test results until an adapter can provide trustworthy result evidence.

Compare the current map with a compact companion view using the same session model. This would suit a narrow side window and provide a readable alternative to canvas interaction. A phone-width screenshot is useful responsive testing, but the server binds to loopback: the current product is not a remotely accessible phone companion.

Accessibility needs behavioral verification. W3C guidance calls for visible keyboard focus and programmatically exposed status messages without requiring focus changes. The existing arrow navigation and live region are a good start; invisible roster focus and selected-session-only announcements need attention. Preserve DOM identity, announce meaningful changes once, and avoid rereading age text every 15 seconds. [W3C focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html), [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)

Add an explicit quiet-motion setting alongside the existing system preference support. Freeze decorative motion while keeping live status current; test whether travel itself should become an immediate relocation in that mode. Evaluate continuous movement against the relevant pause/stop guidance rather than treating frozen sprite frames as complete coverage. [W3C motion and updating-content guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)

**Engineering direction**

Retain Node, native browser modules, SSE, and the canvas renderer. Introduce boundaries as required by specific work, without a wholesale rewrite:

| Boundary | Responsibility | First practical use |
| --- | --- | --- |
| Provider adapter | Normalize events, discover sessions, verify ownership, report capabilities and compatibility. | Isolate Claude's process and session-note assumptions. |
| Session store | Own identity, ordering, lifecycle, counts, and bounded history independently of presentation. | Inspect hidden sessions without forcing them into a map slot. |
| View model | Derive attention queue, source addresses, selection, and accessible sentences. | Keep map, picker, and compact view consistent. |
| Renderer | Draw the world and expose matching hit regions. | Make inspector-edge markers usable. |
| Local service/installer | Start, stop, diagnose, update, and remove the installation predictably. | Remove the need to keep a dedicated server terminal open. |

Before enabling another provider, add a versioned event schema, explicit provider IDs, composite session keys, capability reporting, and a shared adapter contract suite. Strengthen timestamp validation and duplicate-event handling: ordering currently relies on timestamps, and helper counts use deltas that can drift if lifecycle events repeat. Keep missing evidence visibly unknown.

Separate resilience from admission: keeping an already verified session during a failed process probe is reasonable; accepting a previously unseen session when the process table is unavailable deserves a different policy. Today `verifyEventOwner()` can return success when that table is unavailable. Process/session matching also establishes plausibility, not authentication of the HTTP sender. Before wider distribution, define that trust boundary, restrict static serving to intended public files, validate request inputs and local origins/hosts, and consider a local adapter credential. These are code-review hardening recommendations, not a claim of a demonstrated remote exploit.

The privacy design is valuable, but a field allowlist is not a guarantee that arbitrary text fields contain no secrets. Bound and validate label/category fields, explain what remains locally, and make diagnostic exports explicitly inspectable. Keep source paths required for a future terminal-focus integration private to the local resolver rather than adding them to event history.

Measure everyday overhead before selecting a desktop wrapper. The app redraws continuously; the bridge runs synchronous process/filesystem probes; each hook also discovers ancestry. Benchmark idle CPU, memory, wakeups, event latency, and hook latency with the bridge available and unavailable. The art harness's drawing benchmark alone does not measure battery impact or the full pipeline.

**Development and release workflow**

Keep the existing test suite and isolated art harness. Add a browser-level integration layer with isolated fixtures and no connection to the production event endpoint. The history explains why fabricated live sessions were dangerous; it does not require abandoning deterministic browser testing. The existing synthetic art harness already demonstrates the correct separation.

Start browser tests with the risks this review found: five waiting sessions, selecting hidden work, focus surviving updates, a bridge outage, a project-only install, inspector-edge selection, and reduced motion. Keep source-contract tests where they protect a real invariant, but do not use a matching function name or CSS rule as evidence that an interaction works.

This supplied folder contains no `.git`, `.github`, `.gitignore`, or license file. That does not prove the upstream project lacks them. If this folder is the development source, establish version control and automated checks; if it is an exported checkpoint, connect it to the canonical repository. Before public distribution, choose code and art licensing, define packaged files, and establish an upgrade/uninstall path.

Reconcile documentation now: README says 152 tests; 160 pass. Package metadata is 0.14 while a v0.15 iteration log exists. The README describes a widening inspector, while code and current UI tests require an overlay. Action atlases and an editable map master already exist, so the old “next” art list is partly obsolete. Keep one current-state specification, an explicitly ordered backlog, and historical decision records with the evidence that would justify revisiting them.

**Proposed roadmap**

Timing is a planning estimate for one experienced developer with part-time design/research help. Advance by the exit criteria, not by the calendar.

| Phase | Approximate effort | Deliverables | Exit criteria |
| --- | --- | --- | --- |
| 1. Make current promises true | 5–8 working days | Overflow/attention picker; hidden-session inspection; keyboard/focus fixes; truthful connection diagnostics; documentation reconciliation. | Five waiting sessions are individually reachable by pointer and keyboard; focus survives refreshes; setup scope and event-delivery status are distinguishable; existing checks pass. |
| 2. Complete the daily workflow | 5–8 working days | Consistent source address, copy action, one supported terminal-focus integration, selectable edge markers, compact-view prototype, motion controls. | Users reach the correct source reliably; narrow-window states are readable; reduced motion keeps current status; unsupported focus environments have a clear fallback. |
| 3. Validate with real developers | 1–2 calendar weeks, overlapping phase 2 | Five to eight moderated sessions and a one-week pilot; comparison with terminal checking or a compact status view. | Evidence supports faster detection/handoff and repeat use; lifecycle failures are recorded and fixed; scope changes follow observed needs. |
| 4. Package the proven experience | 5–10 working days after validation | Launch/open/status/stop workflow, stable install location, version-aware diagnostics, release automation, supported-platform matrix, installer recovery and uninstall checks. | A new user reaches a verified session without manual JSON edits; moving/upgrading/removing the app preserves unrelated settings; compatibility limits are published. |
| 5. Expand one dimension | Decide after pilot | Either a second provider, deeper terminal integration, or opt-in notifications, chosen from observed demand. | The addition solves a frequent pilot problem and meets the same truth, privacy, and maintenance gates as Claude support. |

**First tickets to create, in order**

1. **Record the actual baseline.** Update version/docs, document supported scope and capacity, and record the real-session gate result. Do not mark that gate complete from unit tests.
2. **Make every waiting session reachable.** Add the overflow/attention picker and separate selection from map visibility. Acceptance: five waiting sessions, no lost selection, no incorrect dismissal.
3. **Fix focus and announcements.** Preserve roster node identity and visible keyboard focus; announce new actionable states with no selection. Acceptance: keyboard and screen-reader walkthroughs survive timer and SSE updates.
4. **Make connection status evidence-based.** Distinguish installed hooks, discovery, current stream health, and received lifecycle events. Acceptance: absent/broken hooks, project-only setup, and alternate endpoints cannot produce misleading reassurance.
5. **Complete source handoff and covered-session selection.** Show the best known terminal address, add copy/focus capability, and hit-test edge markers. Acceptance: a user can reach the correct session without guessing among identical status icons.
6. **Run the comparison study.** Test current map, revised map, and compact view before committing to more world-building.

**Research script and decision gates**

Recruit five to eight developers with varying terminal/editor habits, including people who regularly use more than four sessions. This is a formative sample, not statistical proof. Use disposable repositories and genuine lifecycle events for the end-to-end gate; use clearly labeled isolated fixtures for repeatable comprehension comparisons.

Ask participants to install from the guide; identify broad activity after a three-second glance; find a waiting session among five; distinguish an ended turn from successful checks; locate the corresponding terminal; and recover from a bridge restart. Include keyboard-only use and a narrow side-window layout. Counterbalance the order of map and comparison views to reduce learning effects.

Record task success, time to identify the right session, time to reach its source, missed or false alerts, setup interventions, and confusion about “Done.” During a one-week pilot, ask whether participants voluntarily kept the app open and which terminal checks it replaced. Do not use time spent looking at the map as the success metric.

Suggested product gates—not industry benchmarks—are at least 80% correct broad-state answers within three seconds, every waiting session reachable, median source handoff under ten seconds in a supported environment, at least four of five pilot users completing setup without help, and at least three of five returning voluntarily on three workdays. Adapt thresholds after observing the baseline. If the compact view performs better, preserve the workshop as a chosen ambient view and improve the default operational surface.

**Expansion choices after validation**

The best candidates are compact mode, opt-in attention notifications with deduplication and quiet hours, project/worktree filtering, and better terminal focus. A second provider is worthwhile when pilot users repeatedly need it and its supported signals can meet the reliability contract. Re-evaluate current provider APIs at that time; the old removed adapter is historical evidence, not a ready-made implementation.

Defer additional biomes, more familiar species, map editing, accounts, team dashboards, transcript search, and agent control. Existing art already supplies enough variety to validate the core experience. Cloud and control features would create a substantially different product and require a separate scope decision.

If this becomes a business, validate willingness to install, retain, and pay before choosing pricing. Competing projects establish category activity, not willingness to pay for The Patch. The first commercially meaningful milestone is a small group who reliably uses it during real work and can name the interruptions or missed approvals it prevents.

# The Patch: one-command installation proposal

Researched September 26, 2026 against package 0.14.0.

Status: steps 1–4 implemented in 0.15.0-beta.1 (durable runtime, background service, CLI, truthful connection states; covered by `tests/runtime.test.js`). Still open: package name/registry, license, CI matrix, Linux/WSL certification, beta-user acceptance tests. Command examples below describe the proposed release. `@YOUR_SCOPE/the-patch` is a placeholder; no npm name has been selected or reserved.

**Recommendation**

Make installation and daily launch the next release milestone. Ship The Patch as a small npm CLI that installs its local integration, starts or reuses its background server, and opens the map with one command:

```sh
npx --yes @YOUR_SCOPE/the-patch@latest
```

The user keeps using Claude Code normally. No repository clone, build, project dependency, manual JSON edit, separate connect command, or dedicated server terminal belongs in the normal path. The first launch should briefly explain: “Sets up The Patch for your local Claude Code projects and opens the map.”

Remove the permanent “Claude Code connected” button once this workflow exists. Use a short, noninteractive status sentence when needed, with troubleshooting under a small Help menu. A healthy populated map needs no setup banner.

This advances packaging ahead of the earlier roadmap's later distribution phase, following the current product priority. Truthful connection status is part of this work. The earlier accessibility and session-overflow findings remain release considerations.

**What exists today**

| Finding | Evidence | Consequence |
| --- | --- | --- |
| A useful CLI and dependency-free runtime already exist. | `package.json`, `bin/the-patch.mjs`, `server.mjs` | Keep the architecture; a framework or desktop rewrite is unnecessary for the first package. |
| The default CLI installs hooks but does not launch the server or browser. | `scripts/connect.mjs` | Publishing the current folder would not produce the promised one-command experience. |
| Hooks embed the current Node executable and adapter paths. | `scripts/claude-setup.mjs` | Moving the folder, clearing an npx cache, or deleting that Node version can break the integration. |
| Configuration inspection is presented as connection success. | `src/app.js`, `server.mjs` | Configured hooks and independently discovered sessions do not prove hook delivery. |
| Endpoint settings are separate. | `PATCH_PORT`, `PATCH_ORIGIN`, `PATCH_ENDPOINT`, status-line code | Choosing another server port can leave senders using 4173. |
| User paths assume `~/.claude`; process discovery uses `ps`; PATH parsing uses `:`. | Setup, session-registry, session-proof, process-liveness, connect modules | Custom profiles and native Windows need deliberate support. |
| No npm payload allowlist exists. | `npm pack --dry-run --json --ignore-scripts` | Current archive: **115,974,286 bytes compressed**, 116,824,442 bytes unpacked, 200 files. It includes editable art, reference documents, editor files, tests, and `.claude` content. |
| No Git repository or license exists in this supplied folder. | Root inspection | Establish repository and licensing before public release; this does not prevent local package testing now. |

Baseline verification: all **160 tests passed** on Node 22.20.0. The pack command was a dry run; nothing was published. No real Claude settings were changed and no live-session compatibility gate was performed for this proposal.

**What the external research establishes**

These are current documented behaviors; the architecture recommendations that follow are our design decisions.

- npm supports executable packages through `bin`, and controls their payload through `files`. Use both explicitly. [npm package metadata](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)
- npx downloads missing packages into npm's cache and ordinarily asks before installation; `--yes` suppresses that npm prompt. Therefore persistent hooks should not reference that cache. Running npx also does not install a permanent global command. [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
- Claude supports user-wide hooks, exec-form commands with argument arrays, and normally watches direct hook-setting edits. Managed policy can restrict hooks. This supports automatic local setup, but not a blanket promise that every installation takes effect immediately. Keep the normalizer in the local command adapter to sanitize input before transmission. [Claude hook reference](https://code.claude.com/docs/en/hooks)
- `CLAUDE_CONFIG_DIR` changes the configuration location. The installer, discovery, status checks, and hooks must agree on it. [Claude settings](https://code.claude.com/docs/en/settings)
- A Claude plugin is a credible second distribution path. Current documentation includes a combined marketplace/install command on sufficiently recent versions, with marketplace confirmation and scope selection. It still needs to deliver and run our local server. [Claude plugin installation](https://code.claude.com/docs/en/discover-plugins)
- Claude's native executable does not require Node at runtime. Having Claude installed therefore does **not** establish that npm is available. [Claude installation](https://code.claude.com/docs/en/setup)
- Node 22 and 24 are LTS lines; Node 20 is EOL. Test 22 and 24 and recommend 24 for new users rather than retaining Node 20 as the release baseline. [Node releases](https://nodejs.org/en/about/previous-releases)

**The intended first minute**

1. User runs the published command from any directory.
2. CLI checks runtime and Claude compatibility, stages durable runtime files, and installs the integration for the selected Claude profile. The default is all local projects in that profile.
3. CLI starts or reuses The Patch and opens the browser automatically. Browser-launch failure prints a clickable local URL without failing installation.
4. With no sessions, the map says: **“Ready for Claude Code. Start a session in any project.”**
5. Existing sessions appear when supported discovery evidence exists. Their presence is not reported as proof that hooks work.
6. A real hook event verifies lifecycle delivery. The user proceeds with ordinary work; no fabricated session or test prompt is sent to Claude.

Proposed terminal output:

```text
The Patch is ready.
Watching this Claude Code profile's local projects.
Opening http://127.0.0.1:4173
You can close this terminal.
```

Only print that last line after the server is independent of the launching terminal and has passed readiness checks. If setup is incomplete, say what failed instead of printing success.

Returning users can rerun the same npx command. People who prefer a short command may optionally install globally and run `the-patch`. Do not require both install styles in the quickstart. After installation, bookmarking the local page provides another daily entry point while the background process is running.

**Distribution choice**

| Approach | Recommendation | Reason |
| --- | --- | --- |
| npm CLI plus browser | Primary initial release | Reuses the app and fits developers with Node/npm. One published command can perform setup and launch. |
| Claude plugin | Follow-up using the same runtime | Useful discovery and native integration management. Validate runtime delivery, upgrade behavior, and removal before promising a simpler experience. |
| Standalone download with bundled runtime | Follow-up for users without Node/npm | Removes the principal prerequisite but adds platform builds, signing, and updates. |
| Hosted webpage alone | Documentation/marketing only | A public page cannot directly inspect the user's local processes or configure Claude; the local companion is still required. |

Do not add MCP to solve installation. This app observes lifecycle events; its current hook adapter already supplies the relevant interface. Keep optional distribution channels from registering duplicate hooks.

**Runtime and installation design**

Use npm as the delivery mechanism and a user-owned directory as the installed runtime. A proposed layout, extending the existing `~/.the-patch` location:

```text
~/.the-patch/
  install.json              # installed version, profile, ownership records
  launcher/                 # stable hook/status-line launchers
  versions/<version>/       # complete packaged runtime and browser assets
  runtime.json              # active instance, endpoint, protocol, process identity
  familiars.json            # existing familiar identities
  logs/                     # bounded operational logs, no raw hook payloads
```

The installer stages the exact downloaded package, checks required files, then atomically activates it. Launchers resolve the active version through the manifest. Neither hooks nor server assets depend on the source checkout or npx cache. Keep the previous working version until upgrade health checks pass. Serialize competing installers; a failed upgrade must leave the previous installation usable.

The npm release still depends on a supported local Node executable. Record and validate the interpreter on each explicit launch/repair, and test version-manager changes. An absolute interpreter path is reliable only while that installation exists. Do not copy an arbitrary Node binary as an improvised runtime bundle. Fully surviving Node removal belongs to the later standalone distribution.

Make `server.mjs` callable by the launcher instead of starting merely as an import side effect. Add an instance identity and protocol version to health responses. Use a per-user instance lock and verify process start identity before reusing or stopping a server; a PID or occupied port alone is insufficient.

Persist the actual endpoint centrally. Hooks, CLI, status line, and browser launch all resolve it from the same runtime record. Try 4173 first; if another application owns it, bind another loopback port and publish that endpoint atomically. Never terminate an unrelated process or mistake an arbitrary HTTP 200 for The Patch.

Support two lifecycles:

- Explicit launch starts the background server, opens the browser once, and returns to the shell. `--foreground` and `--no-open` support debugging and headless environments.
- An installed hook can restart a missing server after a reboot or crash, without opening browser tabs. Use one locked, bounded background startup path. The triggering event must reach the ready server through bounded retry or a short-lived sanitized queue. No npm download or update may run inside a Claude hook.

`stop` sets a paused flag before stopping the owned server, so the next Claude event does not immediately resurrect it. Explicit launch resumes it. Defer login-service registration; hook-based restart is enough for the first release, but a dead bookmarked page cannot restart the app by itself. Rerunning the command must always recover that case.

**Claude integration contract**

Keep the existing installer and expand its guarantees:

- Resolve `CLAUDE_CONFIG_DIR` consistently. Start with one profile per installation; adding other profiles must be explicit, not a scan of unrelated account directories.
- Detect Claude with an executable/version probe. The mere existence of `.claude` is insufficient. On failure, print a precise next step and leave settings untouched. Do not ask for Claude credentials or launch a paid model request.
- Merge only Patch-owned settings, preserve other tools' hooks and permissions, and make repeated launches idempotent. Use ownership records for new installs and carefully migrate recognized prototype entries.
- Handle invalid JSON and read-only files without truncation or replacement. Atomic rename alone does not prevent lost concurrent edits: re-read before committing, detect changes, and retry a bounded merge.
- Record rollback information for touched keys; never restore an entire old settings file over later user edits. Backups, if used, stay private and local.
- If a user already has a custom status line, preserve it by default and offer familiar-prefix integration as an advanced option. If none exists, install The Patch's status line. Neither condition blocks the map. On removal, restore only a status line that is still Patch-owned.
- Distinguish unsupported Claude versions, disabled hooks, and managed restrictions from “no sessions.” Do not rewrite policy or trust settings to work around them.

Resolve the README/CLI disagreement about restarting Claude: current documentation says settings changes are normally watched. Test this on the declared versions and instruct a restart only when justified. Do not promise either “always restart” or “never restart.”

The current per-process session notes are a compatibility risk: I did not establish a public schema contract in the documentation reviewed. Isolate them behind a Claude adapter and test recorded schemas plus real versions. If discovery becomes unavailable, preserve already verified sessions appropriately and disclose limited detection. Do not silently weaken admission checks or read full transcripts to make an empty map disappear. A hook-only fallback needs an explicit ownership model and tests before release.

**Replace the connection button with meaningful states**

| Evidence | User-facing message | Behavior |
| --- | --- | --- |
| Setup in progress | “Setting up The Patch…” | Brief progress; no connect action. |
| Setup ready, server healthy, no sessions | “Ready for Claude Code. Start a session in any project.” | Normal empty map; no repeated install command. |
| Sessions discovered, hook delivery unverified | “Found your sessions. Waiting for live activity.” | Show truthful available state; put technical details under Help. |
| Live events received | No persistent setup banner | Familiars are the primary feedback. |
| Stream interrupted | “Reconnecting…” | Retain last known state with freshness indication. |
| Claude unavailable | “Claude Code wasn't found.” | One relevant installation/help link. |
| Hook/runtime issue diagnosed | “The Patch needs a quick repair.” | Show the published repair command and specific cause in details. |
| Policy prevents integration | “Your Claude Code settings block this integration.” | Explain the restriction; avoid an endless repair loop. |
| Process detection unavailable | “Session detection is limited in this environment.” | Do not claim complete coverage. |

Represent service health, installation validity, compatibility, discovered sessions, and received hook events separately internally. Track delivery per session as well as for the instance; one successful session does not prove every project works. Inactivity alone is not a failure. Use an accessible status region that announces meaningful transitions rather than each heartbeat.

An installer self-check can prove that the adapter reaches the server, but cannot prove Claude invoked it. Keep those checks distinct, and keep any test traffic out of the visible world.

**Small command surface**

These are proposed commands, not currently supported commands. Under npx, append each subcommand to the published package invocation.

| Command | Purpose |
| --- | --- |
| `the-patch` | Install if needed, resume/start/reuse, open. |
| `the-patch status` | Read-only report of actual service, profile, compatibility, and delivery evidence. |
| `the-patch doctor` | Read-only diagnosis with actionable recovery instructions. |
| `the-patch repair` | Reinstall owned integration and repair paths without changing unrelated settings. |
| `the-patch stop` | Pause automatic restart and stop only the owned server. |
| `the-patch uninstall` | Stop, remove owned integration/runtime, retain familiar history by default. |

Keep `connect`/`disconnect` as compatibility aliases with documented semantics. An optional explicit purge can remove retained Patch data. npm package removal alone is not integration removal; document the app's uninstall command first. A global npm installation, if chosen, is removed separately by npm.

Rerunning `npx --yes @YOUR_SCOPE/the-patch@latest` is the explicit update path. Stage and verify upgrades, preserve identities, negotiate or restart mismatched server versions, and recover if activation fails. Do not update during normal hook execution.

**Package contents and repository preparation**

Create a deterministic staging step that copies the runtime into a publishable directory and records its file manifest. Include the CLI, server modules, adapters, installer/runtime helpers, browser HTML/CSS/JS, and every referenced runtime asset. Validate dynamic sprite paths and fallback assets as well as static imports. Keep editable art and design references in the source repository, outside the npm payload.

Set an explicit `files` allowlist and `bin`; add repository, issues, homepage, license, supported engines, and publication metadata when the owner/name are chosen. Keep `private: true` until preparing the actual publishable package. Avoid setup side effects in `postinstall`: installing a package as a dependency must not start a server or edit Claude settings.

Proposed payload budget: **under 15 MB compressed**, subject to measuring the complete runtime asset closure. The current 116 MB archive gives a clear baseline, not proof that the target has been achieved. Add a packed-file assertion so future source art cannot quietly re-enter it.

Before creating the public GitHub repository, prepare `.gitignore`, code licensing, asset provenance/licensing, contributor instructions, and a minimal issue template for version/platform/doctor output. Code and artwork may need different license declarations; choose them before publishing. Exclude personal configuration and generated archives. Select an available npm name under an account the project owner controls.

CI should test supported Node/platform combinations, build the runtime, inspect `npm pack`, and install that exact tarball in an isolated home from an unrelated working directory. Public GitHub Actions releases can use npm trusted publishing and provenance after the npm package/account and trusted publisher are configured. [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/)

No GitHub Pages deployment, domain, account service, or public app backend is required for the local product. GitHub hosts source/releases; npm distributes the package; the user's machine runs the app.

**Implementation sequence and completion gates**

Planning estimate: roughly **7–12 focused engineering days** for a tested macOS-first npm beta, with compatibility work the largest uncertainty. This is a scope estimate, not a delivery commitment. Linux and native Windows certification add work.

| Order | Work and primary files | Completion gate |
| --- | --- | --- |
| 1 | Package staging and durable layout: `package.json`, new packaging/runtime modules, `bin/the-patch.mjs` | Packed install runs outside the checkout; moving the checkout and removing its disposable npx cache cannot break installed paths. |
| 2 | Single launch flow: CLI, `server.mjs`, `src/event-server.js`, new process manager | One command opens the app, returns to shell, survives terminal closure, and reuses the correct instance; occupied ports work. |
| 3 | Robust integration: `scripts/claude-setup.mjs`, hooks, profile resolution and compatibility adapter | Real Claude events arrive on supported versions; custom config paths, upgrades, repair, stop, and uninstall preserve other settings. |
| 4 | Calm onboarding: `src/app.js`, `index.html`, styles and UI contracts | Permanent connect button removed; empty, live, interrupted, and blocked states are truthful and accessible. |
| 5 | Tarball QA and beta docs: CI, README, getting-started, manifest | Fresh-machine testers complete the published workflow without author assistance; support matrix and limitations are explicit. |

Prototype the first two steps locally before creating the public repository. Test with a packed tarball and disposable user directories. No registry publication is needed to establish that the install experience works.

**Release acceptance tests**

1. A supported fresh environment with Claude and Node installed reaches the opened map with one command, no JSON editing, and no retained server terminal. Target under 60 seconds excluding slow package downloads; measure rather than assume.
2. A real supported Claude session produces a visible familiar within three seconds of an accepted event. Cover permissions, interrupted turns, normal stops, subagents, and session end.
3. Repeated and simultaneous launches create one owned service. A foreign listener on 4173 is preserved and every sender uses the chosen alternate endpoint.
4. Setup works with paths containing spaces/apostrophes, custom Claude configuration, another working directory, existing hooks, and a custom status line.
5. Failed settings writes, invalid JSON, stale interpreter paths, blocked hooks, and unsupported process discovery give accurate recovery instructions rather than “connected.”
6. Closing the launch terminal does not stop the server. Reboot/crash recovery via a real hook works without an npm/network lookup; `stop` stays stopped until explicit resume.
7. Upgrade preserves familiar history and settings, rejects incompatible runtime combinations, and rolls back after failed readiness. Clearing only the test installation's npx cache does not affect its durable runtime.
8. Uninstall removes only owned entries, leaves subsequent user changes intact, and does not kill Claude or unrelated processes. Test uninstall after a partially failed installation too.
9. Static routes expose only browser files. Keep loopback binding; validate Host/Origin and restrict mutations to authenticated local callers. A local per-install credential can strengthen sender identity, but it does not protect against malicious software running as the same user. Never expose credentials or Claude settings as static content.
10. Hook failures never block Claude work. Measure latency with the server healthy, stopped, and starting; use a proposed p95 overhead budget of 100 ms on the supported baseline and investigate outliers. Bound queues, retries, logs, and restart attempts.
11. Test native macOS first. Promote Linux/WSL only after process, filesystem, and browser-launch gates pass. Native Windows requires a process-discovery implementation and executable/path tests; npm compatibility alone is not platform support. Keep remote/SSH/container sessions outside the initial same-environment promise.
12. At least four of five beta users install and reach real activity unaided. Record time, retries, and interventions. A quiet map alone is not installation success.

**The next concrete ticket**

“Make a packed local tarball launch The Patch from any directory, install its runtime durably, configure Claude, and open the map without a server terminal.”

Finish that complete path before deleting the existing connection UI. The visible simplicity should be the result of dependable installation and recovery underneath it.

# Getting started

One command to a moving familiar.

## 1. Requirements

macOS (Linux/WSL in beta), Node.js 22 or newer (24 LTS recommended), and
Claude Code on your `PATH`. Native Windows is not supported yet; run Daemonwood
inside WSL next to Claude Code.

## 2. Wake Daemonwood

From any directory:

```bash
npx daemonwood wake
```

npm asks once to download the package; say yes. That one command checks Node
and Claude Code, copies a durable runtime into `~/.daemonwood/versions/`,
writes Daemonwood's hooks into your Claude Code user settings
(`~/.claude/settings.json`, or `$CLAUDE_CONFIG_DIR/settings.json`), starts a
background service and opens the map. It prints the address and returns to the
shell, so you can close the terminal. Nothing refers back to npm's cache (or to
a clone, if you ran `npm start` from one) afterwards.

It covers **every project** in that Claude Code profile. Sessions that are
already open appear from Claude Code's own session notes; sessions started from
now on report every move as it happens. Your other hooks and settings are kept.

## 3. Work normally

Give an agent a real task that reads, edits, and tests. Its familiar walks
between the Research Desk, Workbench, Command Console, and Test Dungeon. If it
asks for approval it waits at the Permission Gate. When the turn ends it stops
at the Shipping Dock, and after five quiet minutes it rests at the Campfire.

## 4. Everyday commands

```bash
npx daemonwood wake        # set up / resume / reopen the map
npx daemonwood status      # service, Claude Code and hook check
npx daemonwood repair      # rewrite Daemonwood's hooks and restart
npx daemonwood sleep       # pause; Claude events will not wake it
npx daemonwood uninstall   # remove hooks and runtime, keep familiar names
```

After the first wake the same commands work as `~/.daemonwood/bin/daemonwood
<command>`, without npm. From a clone they are `npm start`, `npm run status`,
`npm run repair`, `npm run stop` and `npm run disconnect`.

Options: `--no-open` prints the address instead of opening a browser;
`--no-statusline` leaves Claude Code's status line alone; `--wrap-statusline`
puts each session's familiar name in front of a status line you already have
(without it, an existing custom status line is left untouched).

The connection dialog on the map (press `C`) shows the exact repair and status
commands for your install.

## 5. If nothing appears

Run `status` first. It reports whether the service is running, the Claude Code
version, whether all twelve hooks are installed with the current Node path, and
whether any events have been received.

Still stuck:

1. Check the map's corner button. **Ready for Claude Code** means hooks are
   installed but no event has arrived yet; **Receiving Claude events** means
   delivery works.
2. Open the health endpoint the launcher printed (`…/api/health`).
   `receivedEvents` climbing means the hooks are firing; `refusedEvents`
   climbing means they are firing but the bridge cannot tie them to a running
   Claude Code process, and `lastRefusal` says why.
3. Press `` ` `` to open the event console and watch what actually arrives,
   refusals included.
4. Start a new session. A session already open is on the map from Claude
   Code's note, but reports each move only once its hooks are loaded.
5. The service log is `~/.daemonwood/service.log`.

More detail, including the full state mapping, is in
[`connecting-agents.md`](connecting-agents.md).

## Developing Daemonwood

`npm run dev` serves the checkout directly in the foreground (it also serves
the art review pages under `docs/`), and `npm test` runs the suite. The dev
server does not install anything. `node scripts/connect.mjs /path/to/project`
is still available from the checkout for a single-project hook install.

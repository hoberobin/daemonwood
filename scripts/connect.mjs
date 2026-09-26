#!/usr/bin/env node
/* The single front door: `npm run connect`.

   Daemonwood watches Claude Code. Claude Code reads hooks from ~/.claude, so
   one install covers every project you will ever open — there is no per-agent
   matrix here and no trust step to explain. Naming a project narrows the
   install to that repo instead, for when you want one project on the map
   rather than all of them.

   Everything here delegates to claude-setup.mjs, which stays the source of
   truth for what a hook entry looks like. */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CLAUDE_EVENTS, check, checkStatusLine, cleanLegacyUserLocal, install, installStatusLine, uninstall, uninstallStatusLine } from "./claude-setup.mjs";
import { setting } from "../src/local-paths.js";

const BRIDGE_ORIGIN = setting("ORIGIN") || "http://127.0.0.1:4173";

/* `connect` with no arguments means every project. A path narrows it to one.
   `--no-statusline` leaves the terminal's status line alone. */
export function parseArguments(argv) {
  let projectDirectory = null;
  let statusLine = true;
  for (const argument of argv) {
    if (argument === "--all") continue;
    if (argument === "--no-statusline") { statusLine = false; continue; }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}. Usage: npm run connect -- [project] [--no-statusline]`);
    if (projectDirectory) throw new Error("Give at most one project directory.");
    projectDirectory = argument;
  }
  return { projectDirectory, statusLine };
}

/* Where the hooks get written. "Everywhere" is really the home directory,
   because ~/.claude/settings.json is the user-level file Claude Code reads
   for every session it starts. (Not settings.local.json: that name is only
   read inside a project, and a user-level copy is read by nothing.) */
export function resolveTarget({ projectDirectory = null, home = homedir() } = {}) {
  if (projectDirectory) return { directory: resolve(projectDirectory), scope: "project" };
  return { directory: home, scope: "everywhere" };
}

export function scopeLabel(target) {
  return target.scope === "everywhere" ? "every project" : basename(target.directory) || target.directory;
}

/* Writing hooks into a ~/.claude that nothing reads is a silent no-op, and a
   quiet map is the most expensive way to discover it. This never blocks the
   install — a fresh install or an unusual PATH is not an error — it just says
   so plainly. */
export function claudeInstalled({ home = homedir(), pathEntries = splitPath(process.env.PATH) } = {}) {
  return existsSync(join(home, ".claude")) || pathEntries.some((entry) => existsSync(join(entry, "claude")));
}

function splitPath(value) {
  return String(value || "").split(":").filter(Boolean);
}

export async function bridgeHealth(origin = BRIDGE_ORIGIN) {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(900) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/* One action, one plain record, so the printer stays dumb. The status line is
   the second thing connect touches: it is per user, not per project, so it goes
   in the user's own settings whatever the hooks' scope. */
export async function run(action, target, { statusLine = true, home = homedir() } = {}) {
  const perform = action === "connect" ? install : action === "disconnect" ? uninstall : check;
  try {
    const result = await perform(target.directory, { scope: target.scope });
    const record = {
      target,
      file: result.settingsFile,
      configured: result.configured.length,
      total: CLAUDE_EVENTS.length,
      missing: result.missing,
      ok: result.missing.length === 0
    };
    /* The old installer's file. Nothing reads it, so anything of ours left
       there is a connection that only looks like one. */
    if (target.scope === "everywhere" && action !== "status") record.legacy = await cleanLegacyUserLocal({ home });
    /* The status line is per user, so it comes with any connect — but only
       the user-wide disconnect takes it away. Disconnecting one project must
       not silently unwrap the status line every other project relies on. */
    if (action === "connect" && !statusLine) record.statusLine = { skipped: true };
    else if (action === "disconnect" && target.scope !== "everywhere") record.statusLine = await checkStatusLine({ home });
    else {
      const performStatusLine = action === "connect" ? installStatusLine : action === "disconnect" ? uninstallStatusLine : checkStatusLine;
      record.statusLine = await performStatusLine({ home });
    }
    return record;
  } catch (error) {
    return { target, error: error.message };
  }
}

/* ---- printing ---- */

const PAD = "  ";
const GUTTER = " ".repeat(14);

function line(label, value) {
  console.log(`${PAD}${label.padEnd(14)}${value}`);
}

/* Paths under the home directory read better short, and give away less. */
function tilde(path) {
  const home = homedir();
  return typeof path === "string" && home && path.startsWith(home) ? `~${path.slice(home.length)}` : String(path);
}

function detail(value) {
  console.log(`${PAD}${GUTTER}${value}`);
}

/* The terminal side of "which one is Moss?". Say what was wrapped, so a status
   line that looks different tomorrow is not a mystery, and how to undo it. */
function printStatusLine(statusLine, action) {
  if (!statusLine) return;
  if (statusLine.skipped) {
    line("Status line", "left alone (--no-statusline)");
    return;
  }
  if (action === "disconnect") {
    line("Status line", statusLine.active ? "still shows familiars (npm run disconnect with no project restores it)" : "restored");
    detail(tilde(statusLine.settingsFile));
    return;
  }
  if (!statusLine.active) {
    line("Status line", "not showing familiars");
    detail("→ Run npm run connect to add the familiar's name to each session's status line.");
    return;
  }
  line("Status line", "shows each session's familiar");
  detail(tilde(statusLine.settingsFile));
  detail(statusLine.wraps ? `In front of: ${statusLine.wraps}` : "Appears once a session is on the map.");
}

export function printReport(record, action, health, { installed = true } = {}) {
  console.log("");
  console.log(`${PAD}Daemonwood · ${action}`);
  console.log("");

  if (record.error) {
    line("Claude Code", `could not be ${action === "disconnect" ? "disconnected" : "connected"}`);
    detail(record.error);
    console.log("");
    return;
  }

  if (action === "disconnect") {
    line("Claude Code", `disconnected from ${scopeLabel(record.target)}`);
    detail(tilde(record.file));
    if (record.legacy?.removed) detail(`Also removed ${record.legacy.removed} stale handlers from ${tilde(record.legacy.legacyFile)}.`);
    printStatusLine(record.statusLine, action);
  } else {
    line("Claude Code", record.ok
      ? `connected · ${scopeLabel(record.target)}`
      : `incomplete · ${record.configured} of ${record.total} hooks`);
    detail(tilde(record.file));

    /* A count alone makes you go looking. Name what is missing and the command
       that fixes it, so a stale install from an older version is a ten-second
       problem rather than a mystery. */
    if (!record.ok) {
      detail(`Not installed: ${record.missing.join(", ")}`);
      detail("→ Run npm run connect to add them.");
    } else if (!installed) {
      detail("Claude Code was not found on this machine.");
      detail("→ Install it, then run npm run connect again.");
    } else {
      detail("Sessions started from now on report to the map; restart any you want to keep watching.");
    }
    if (record.legacy?.removed) detail(`Removed ${record.legacy.removed} stale handlers from ${tilde(record.legacy.legacyFile)}, which Claude Code never read.`);
    printStatusLine(record.statusLine, action);
  }
  console.log("");

  if (action === "disconnect") return;

  if (health) {
    line("Bridge", `listening · ${BRIDGE_ORIGIN}`);
    detail(health.sessions
      ? `${health.sessions} session${health.sessions === 1 ? "" : "s"} connected right now.`
      : "No sessions connected yet.");
    /* A refusal is normally the bridge doing its job and worth no words. But if
       yours are the events being turned away, the map looks like a quiet day
       and nothing else would ever tell you otherwise. */
    if (health.refusedEvents) {
      detail(`${health.refusedEvents} event${health.refusedEvents === 1 ? "" : "s"} refused: could not be tied to a running Claude Code process.`);
      if (health.lastRefusal) detail(`→ Last: ${health.lastRefusal.reason}`);
    }
  } else {
    line("Bridge", "offline");
    detail(`→ Run npm start, then open ${BRIDGE_ORIGIN}`);
  }
  console.log("");
}

async function main(argv = process.argv.slice(2)) {
  const [first = "connect", ...rest] = argv;
  const actions = new Set(["connect", "status", "disconnect"]);
  /* `npm run connect -- /path` lands here with no action word, so treat a
     leading non-action as the start of the arguments. */
  const action = actions.has(first) ? first : "connect";
  const argumentList = actions.has(first) ? rest : argv;

  const { projectDirectory, statusLine } = parseArguments(argumentList);
  const record = await run(action, resolveTarget({ projectDirectory }), { statusLine });
  const health = action === "disconnect" ? null : await bridgeHealth();
  printReport(record, action, health, { installed: claudeInstalled() });

  const failed = record.error || (action !== "disconnect" && !record.ok);
  if (failed || (action === "status" && !health)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Daemonwood: ${error.message}`);
    process.exitCode = 1;
  });
}

export { main };

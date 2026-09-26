/* What a Daemonwood hook entry looks like, and how it is written, read and removed.
   The one source of truth for that; scripts/runtime.mjs installs through it,
   and scripts/connect.mjs remains as the source checkout's per-project tool. */
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const daemonwoodRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const hookPath = join(daemonwoodRoot, "hooks", "daemonwood-hook.mjs");
const statusLinePath = join(daemonwoodRoot, "hooks", "daemonwood-statusline.mjs");

/* The twelve hooks the map listens to. TaskCreated and TaskCompleted were
   subscribed once and are not any more: they report the session's own task
   list changing, not a helper starting or stopping, and counting them showed
   helpers that did not exist. Reinstalling strips them wherever they linger. */
export const CLAUDE_EVENTS = Object.freeze([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "PostToolUseFailure",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "StopFailure",
  "SessionEnd"
]);

export function daemonwoodHandler({ nodePath = process.execPath, adapterPath = hookPath } = {}) {
  return {
    type: "command",
    command: nodePath,
    args: [adapterPath],
    timeout: 2
  };
}

export function addDaemonwoodHooks(settings, options = {}) {
  /* Every one of our handlers is replaced with the current one rather than kept.
     The hook stores an absolute path to the node binary, and that path moves —
     an nvm switch, a Homebrew upgrade. Keeping a handler because it points at
     the right adapter left the stale interpreter in place, so hooks quietly
     stopped running while the installer still counted them as configured.
     Rewriting is also what makes this idempotent: same inputs, same file.

     The strip runs over every event, not only the ones being installed, so a
     hook this version no longer listens to does not keep firing from an older
     install. */
  const next = removeDaemonwoodHooks(settings, options);
  next.hooks ||= {};
  const handler = daemonwoodHandler(options);
  for (const eventName of CLAUDE_EVENTS) {
    const groups = Array.isArray(next.hooks[eventName]) ? next.hooks[eventName] : [];
    next.hooks[eventName] = [...groups, { hooks: [handler] }];
  }
  return next;
}

export function removeDaemonwoodHooks(settings, options = {}) {
  const next = structuredClone(settings || {});
  if (!next.hooks || typeof next.hooks !== "object") return next;

  for (const [eventName, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const remaining = groups.flatMap((group) => {
      if (!Array.isArray(group?.hooks)) return [group];
      const hooks = group.hooks.filter((candidate) => !isDaemonwoodHandler(candidate, options));
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    if (remaining.length) next.hooks[eventName] = remaining;
    else delete next.hooks[eventName];
  }
  if (!Object.keys(next.hooks).length) delete next.hooks;
  return next;
}

export function inspectDaemonwoodHooks(settings, options = {}) {
  const configured = CLAUDE_EVENTS.filter((eventName) =>
    Array.isArray(settings?.hooks?.[eventName]) && settings.hooks[eventName].some((group) =>
      Array.isArray(group?.hooks) && group.hooks.some((candidate) => isDaemonwoodHandler(candidate, options))
    )
  );
  return { configured, missing: CLAUDE_EVENTS.filter((name) => !configured.includes(name)) };
}

/* ---- the status line ----

   The other half of knowing which terminal is which: the terminal says so
   itself. Claude Code runs one status-line command per user, from
   ~/.claude/settings.json, so that is the file this touches — and the only
   key in it. Whatever status line was there before keeps running underneath;
   it is carried inside the wrapper's own command as base64, which is how a
   command full of quotes survives a round trip, and how `disconnect` restores
   it byte for byte. Wrapping a wrapper unwraps first, so a reinstall never
   nests. */
const STATUS_LINE_FLAG = "--then-b64";

export function daemonwoodStatusLine(previous, { nodePath = process.execPath, statusLinePath: path = statusLinePath } = {}) {
  const original = unwrapStatusLine(previous, { statusLinePath: path });
  let command = `${shellQuote(nodePath)} ${shellQuote(path)}`;
  if (original) command += ` ${STATUS_LINE_FLAG} ${Buffer.from(JSON.stringify(original), "utf8").toString("base64")}`;
  return {
    type: "command",
    command,
    ...(original && original.padding !== undefined ? { padding: original.padding } : {})
  };
}

export function isDaemonwoodStatusLine(value, { statusLinePath: path = statusLinePath } = {}) {
  if (value?.type !== "command" || typeof value.command !== "string") return false;
  return value.command.includes(shellQuote(path)) || /hooks[\\/](?:daemonwood|patch)-statusline\.mjs/.test(value.command);
}

/* The status line that was configured before Daemonwood wrapped it, or the
   value itself when it is not ours. `null` when there was none. */
export function unwrapStatusLine(value, options = {}) {
  if (!value || typeof value !== "object") return null;
  if (!isDaemonwoodStatusLine(value, options)) return value;
  const match = new RegExp(`${STATUS_LINE_FLAG} ([A-Za-z0-9+/=]+)`).exec(value.command);
  if (!match) return null;
  try {
    const original = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    return original && typeof original === "object" ? original : null;
  } catch {
    return null;
  }
}

export function addDaemonwoodStatusLine(settings, options = {}) {
  const next = structuredClone(settings || {});
  next.statusLine = daemonwoodStatusLine(next.statusLine, options);
  return next;
}

export function removeDaemonwoodStatusLine(settings, options = {}) {
  const next = structuredClone(settings || {});
  if (!isDaemonwoodStatusLine(next.statusLine, options)) return next;
  const original = unwrapStatusLine(next.statusLine, options);
  if (original) next.statusLine = original;
  else delete next.statusLine;
  return next;
}

export function inspectDaemonwoodStatusLine(settings, options = {}) {
  const active = isDaemonwoodStatusLine(settings?.statusLine, options);
  const original = unwrapStatusLine(settings?.statusLine, options);
  return { active, wraps: active && original?.command ? original.command : null };
}

export function userSettingsFile(home = homedir()) {
  return join(home, ".claude", "settings.json");
}

export async function installStatusLine({ home = homedir(), ...options } = {}) {
  const settingsFile = userSettingsFile(home);
  await mkdir(join(home, ".claude"), { recursive: true });
  const settings = await readSettings(settingsFile);
  const next = addDaemonwoodStatusLine(settings, options);
  const changed = serialize(next) !== serialize(settings);
  if (changed) await atomicJsonWrite(settingsFile, next);
  return { settingsFile, changed, ...inspectDaemonwoodStatusLine(next, options) };
}

export async function uninstallStatusLine({ home = homedir(), ...options } = {}) {
  const settingsFile = userSettingsFile(home);
  const settings = await readSettings(settingsFile);
  const next = removeDaemonwoodStatusLine(settings, options);
  const changed = serialize(next) !== serialize(settings);
  if (changed) await atomicJsonWrite(settingsFile, next);
  return { settingsFile, changed, ...inspectDaemonwoodStatusLine(next, options) };
}

export async function checkStatusLine({ home = homedir(), ...options } = {}) {
  const settingsFile = userSettingsFile(home);
  const settings = await readSettings(settingsFile);
  return { settingsFile, changed: false, ...inspectDaemonwoodStatusLine(settings, options) };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/* ---- where the hooks live ----

   Claude Code reads exactly three settings files for hooks, and the binary
   names them: the user's `~/.claude/settings.json`, a project's
   `.claude/settings.json`, and a project's `.claude/settings.local.json`.
   There is no user-level `settings.local.json`. An earlier version of this
   installer wrote the "every project" install to `~/.claude/settings.local.json`,
   a file nothing reads; two live sessions on the author's machine never
   reached the map that way while `status` reported them connected. So the
   user-wide install goes in `~/.claude/settings.json` — the same file the
   status line already lives in — and a project install stays in that
   project's `settings.local.json`. */
export async function install(targetDirectory, options = {}) {
  const paths = await settingsPaths(targetDirectory, options);
  const settings = await readSettings(paths.settingsFile);
  const next = addDaemonwoodHooks(settings, options);
  const changed = serialize(next) !== serialize(settings);
  if (changed) await atomicJsonWrite(paths.settingsFile, next);
  return { ...paths, ...inspectDaemonwoodHooks(next, options), changed };
}

export async function uninstall(targetDirectory, options = {}) {
  const paths = await settingsPaths(targetDirectory, options);
  const settings = await readSettings(paths.settingsFile);
  const next = removeDaemonwoodHooks(settings, options);
  await atomicJsonWrite(paths.settingsFile, next);
  return { ...paths, ...inspectDaemonwoodHooks(next, options) };
}

export async function check(targetDirectory, options = {}) {
  const paths = await settingsPaths(targetDirectory, options);
  const settings = await readSettings(paths.settingsFile);
  return { ...paths, ...inspectDaemonwoodHooks(settings, options) };
}

/* The file the earlier installer wrote to, which Claude Code never read.
   Connect and disconnect both clear our handlers out of it, so a machine
   that was "connected" by the old version is left with one truth, not two.
   Returns how many handlers were removed; nothing else in the file is
   touched, and a file that does not exist is left that way. */
export async function cleanLegacyUserLocal({ home = homedir(), ...options } = {}) {
  const legacyFile = join(home, ".claude", "settings.local.json");
  let settings;
  try {
    settings = await readSettings(legacyFile);
  } catch {
    return { legacyFile, removed: 0 };
  }
  const before = inspectDaemonwoodHooks(settings, options).configured.length;
  if (!before) return { legacyFile, removed: 0 };
  await atomicJsonWrite(legacyFile, removeDaemonwoodHooks(settings, options));
  return { legacyFile, removed: before };
}

function isDaemonwoodHandler(candidate, { adapterPath = hookPath } = {}) {
  return candidate?.type === "command" && Array.isArray(candidate.args) &&
    candidate.args.some((value) => {
      const path = String(value);
      return resolve(path) === resolve(adapterPath) || /(?:^|[\\/])hooks[\\/](?:daemonwood|patch)-hook\.mjs$/.test(path);
    });
}

async function settingsPaths(targetDirectory, { scope = "project" } = {}) {
  if (scope === "everywhere") {
    const home = resolve(targetDirectory || homedir());
    const claudeDirectory = join(home, ".claude");
    await mkdir(claudeDirectory, { recursive: true });
    return { projectDirectory: home, settingsFile: userSettingsFile(home) };
  }
  if (!targetDirectory) throw new Error("Provide the directory to connect, for example: npm run connect -- /path/to/project");
  const projectDirectory = resolve(targetDirectory);
  await access(projectDirectory, constants.R_OK | constants.W_OK);
  const claudeDirectory = join(projectDirectory, ".claude");
  await mkdir(claudeDirectory, { recursive: true });
  return { projectDirectory, settingsFile: join(claudeDirectory, "settings.local.json") };
}

async function readSettings(settingsFile) {
  try {
    const value = JSON.parse(await readFile(settingsFile, "utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("settings root must be an object");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error(`Cannot update ${settingsFile}: it contains invalid JSON.`);
    throw error;
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function atomicJsonWrite(settingsFile, value) {
  const temporary = `${settingsFile}.daemonwood-tmp`;
  await writeFile(temporary, serialize(value), "utf8");
  await rename(temporary, settingsFile);
}

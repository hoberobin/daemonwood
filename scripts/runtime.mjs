import { mkdir, readFile, writeFile, copyFile, rm, rename, access, open, stat, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { daemonwoodHome, claudeHome, installation, runtime, isPaused, readLocalJson, setting } from "../src/local-paths.js";
import { atomicJson, withLock, editSettings, delay } from "./local-files.mjs";
import { payloadFiles } from "./package-files.mjs";
import { addDaemonwoodHooks, removeDaemonwoodHooks, addDaemonwoodStatusLine, removeDaemonwoodStatusLine, isDaemonwoodStatusLine, inspectDaemonwoodHooks } from "./claude-setup.mjs";

export const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
export const hookOptions = () => ({ adapterPath: join(daemonwoodHome(), "hooks/daemonwood-hook.mjs"), statusLinePath: join(daemonwoodHome(), "hooks/daemonwood-statusline.mjs") });
const runFile = promisify(execFile);

export async function detectClaude() {
  try {
    const { stdout } = await runFile("claude", ["--version"], { timeout: 4000, maxBuffer: 8192 });
    const version = stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
    if (!version) throw new Error("version unavailable");
    return version;
  } catch { throw new Error("Claude Code wasn't found on PATH. Install or update it at https://code.claude.com/docs/en/setup, then run Daemonwood again."); }
}

export async function serviceHealth() {
  const record = runtime();
  if (!record || !/^http:\/\/127\.0\.0\.1:\d+$/.test(record.origin || "")) return null;
  try {
    const response = await fetch(`${record.origin}/api/health`, { headers: { Authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(650) });
    if (!response.ok) return null;
    const health = await response.json();
    return health.product === "daemonwood" && health.instance === record.instance && health.protocol === 1 ? { ...health, origin: record.origin } : null;
  } catch { return null; }
}

export async function ensureRunning({ resume = false } = {}) {
  return withLock(join(daemonwoodHome(), "service.lock"), async () => {
    if (resume) await atomicJson(join(daemonwoodHome(), "paused.json"), false);
    if (isPaused()) return null;
    const installed = installation();
    if (!installed) throw new Error("Daemonwood isn't installed yet. Run the launch command again.");
    let health = await serviceHealth();
    if (health && health.build === installed.build) return health;
    if (health) await stopServiceUnlocked();
    const log = join(daemonwoodHome(), "service.log");
    try { if ((await stat(log)).size > 256 * 1024) await rm(log); } catch {}
    const fd = await open(log, "a", 0o600);
    const child = spawn(installed.nodePath, [join(installed.root, "scripts/daemon.mjs")], {
      cwd: installed.root, detached: true, stdio: ["ignore", fd.fd, fd.fd],
      env: { ...process.env, DAEMONWOOD_HOME: daemonwoodHome(), CLAUDE_CONFIG_DIR: installed.claudeDirectory }
    });
    let failure;
    child.on("error", error => { failure = error; });
    child.unref();
    await fd.close();
    for (let i = 0; i < 70; i++) {
      if (failure) throw failure;
      health = await serviceHealth();
      if (health?.build === installed.build) return health;
      if (child.exitCode !== null) break;
      await delay(60);
    }
    throw new Error(`Daemonwood couldn't start. Run doctor for details. Local log: ${log}`);
  });
}

async function stopServiceUnlocked() {
  const health = await serviceHealth();
  if (!health) return;
  const record = runtime();
  await fetch(`${health.origin}/api/shutdown`, { method: "POST", headers: { Authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(1500) });
  for (let i = 0; i < 40; i++) {
    if (!await serviceHealth()) return;
    await delay(50);
  }
  throw new Error("Daemonwood is still stopping. Try again in a moment.");
}

export async function stopService() {
  await atomicJson(join(daemonwoodHome(), "paused.json"), true);
  return withLock(join(daemonwoodHome(), "service.lock"), stopServiceUnlocked);
}

export async function installRuntime({ root = sourceRoot, statusLine = true, wrapStatusLine = false } = {}) {
  if (!['darwin', 'linux'].includes(process.platform)) throw new Error("This beta supports macOS and Linux/WSL. Native Windows support is still in progress. Run Daemonwood inside WSL alongside Claude Code.");
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error("Daemonwood needs Node.js 22 or newer. Install Node.js 24 LTS, then try again.");
  const claudeVersion = await detectClaude();
  return withLock(join(daemonwoodHome(), "install.lock"), async () => {
    const previous = installation();
    const claudeDirectory = claudeHome();
    if (previous && previous.claudeDirectory !== claudeDirectory) throw new Error(`This Daemonwood installation watches a different Claude profile. Set CLAUDE_CONFIG_DIR to ${previous.claudeDirectory}, or use a separate DAEMONWOOD_HOME for this profile.`);
    const settingsFile = join(claudeDirectory, "settings.json");
    // Validate before staging or replacing any installed integration.
    let settings = {};
    try { settings = JSON.parse(await readFile(settingsFile, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw new Error(`Cannot read ${settingsFile}. Fix its JSON or file permissions, then try again.`); }
    if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw new Error("Claude settings must be a JSON object.");
    if (settings.disableAllHooks) throw new Error("Claude Code hooks are disabled in your user settings. Enable them in Claude Code before launching Daemonwood.");
    const files = await payloadFiles(root);
    const hash = createHash("sha256");
    for (const file of files) { hash.update(file); hash.update(await readFile(join(root, file))); }
    const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const build = `${metadata.version}-${hash.digest("hex").slice(0, 12)}`;
    const destination = join(daemonwoodHome(), "versions", build);
    try { await access(join(destination, "package.json")); }
    catch {
      const stage = `${destination}.stage-${randomUUID()}`;
      try {
        for (const file of files) {
          await mkdir(dirname(join(stage, file)), { recursive: true, mode: 0o700 });
          await copyFile(join(root, file), join(stage, file));
        }
        await rename(stage, destination);
      } finally { await rm(stage, { recursive: true, force: true }); }
    }
    await mkdir(join(daemonwoodHome(), "hooks"), { recursive: true, mode: 0o700 });
    for (const name of ["daemonwood-hook.mjs", "daemonwood-statusline.mjs"]) {
      const launcher = `import { readFileSync } from 'node:fs';\nimport { fileURLToPath, pathToFileURL } from 'node:url';\nimport { dirname, join } from 'node:path';\ntry {\n const home = dirname(dirname(fileURLToPath(import.meta.url)));\n const installed = JSON.parse(readFileSync(join(home, 'install.json'), 'utf8'));\n process.env.DAEMONWOOD_HOME = home;\n process.env.CLAUDE_CONFIG_DIR = installed.claudeDirectory;\n await import(pathToFileURL(join(installed.root, 'hooks', ${JSON.stringify(name)})).href);\n} catch {}\n`;
      const path = join(daemonwoodHome(), "hooks", name);
      const temp = `${path}.tmp`;
      await writeFile(temp, launcher, { mode: 0o600 });
      await rename(temp, path);
    }
    const installed = { version: metadata.version, build, root: destination, nodePath: process.execPath,
      claudeDirectory, claudeVersion, installedAt: previous?.installedAt || new Date().toISOString(),
      previous: summary(previous?.build !== build ? previous : previous?.previous) };
    // Launchers exist before the settings point at them. The manifest switch
    // is atomic; an event during setup sees either complete runtime.
    await atomicJson(join(daemonwoodHome(), "install.json"), installed);
    try {
      await editSettings(settingsFile, value => {
        let next = addDaemonwoodHooks(value, hookOptions());
        if (statusLine && (!value.statusLine || isDaemonwoodStatusLine(value.statusLine, hookOptions()) || wrapStatusLine)) next = addDaemonwoodStatusLine(next, hookOptions());
        return next;
      });
    } catch (error) {
      if (previous) await atomicJson(join(daemonwoodHome(), "install.json"), previous);
      else await rm(join(daemonwoodHome(), "install.json"), { force: true });
      throw error;
    }
    return installed;
  });
}

// Only the fields a rollback needs; a full record would nest every earlier one.
const summary = record => record ? { version: record.version, build: record.build, root: record.root, nodePath: record.nodePath,
  claudeDirectory: record.claudeDirectory, claudeVersion: record.claudeVersion, installedAt: record.installedAt, previous: null } : null;

// Keep the active runtime and the one a rollback would return to; nothing else
// references an older version once the service runs the new build.
export async function pruneVersions() {
  return withLock(join(daemonwoodHome(), "install.lock"), async () => {
    const installed = installation();
    if (!installed) return [];
    const keep = new Set([installed.build, installed.previous?.build].filter(Boolean));
    const directory = join(daemonwoodHome(), "versions");
    const removed = [];
    let names = [];
    try { names = await readdir(directory); } catch { return removed; }
    for (const name of names) {
      if (keep.has(name) || name.includes(".stage-")) continue;
      await rm(join(directory, name), { recursive: true, force: true });
      removed.push(name);
    }
    return removed;
  });
}

/* ---- the old name ----

   Until the rename this lived in ~/.the-patch. The first launch under the new
   name brings the remembered faces across and stops the old service before
   the new one takes its port, so the map keeps its address. The old hook
   launchers are not deleted but become forwarders: a Claude Code session that
   was already running can keep the old hook paths until it restarts, and its
   events should still arrive. Only the default location moves; an explicit
   DAEMONWOOD_HOME (or PATCH_HOME) is used as it is. */
export const legacyHome = () => join(homedir(), ".the-patch");
const LEGACY_LAUNCHERS = [["patch-hook.mjs", "daemonwood-hook.mjs"], ["patch-statusline.mjs", "daemonwood-statusline.mjs"]];

const hasLegacyInstall = async () => {
  if (setting("HOME") || resolve(legacyHome()) === daemonwoodHome()) return false;
  try { await access(join(legacyHome(), "install.json")); return true; } catch { return false; }
};

async function adoptLegacyFaces() {
  await mkdir(daemonwoodHome(), { recursive: true, mode: 0o700 });
  try { await copyFile(join(legacyHome(), "familiars.json"), join(daemonwoodHome(), "familiars.json"), constants.COPYFILE_EXCL); }
  catch {} // none to bring, or this home already remembers its own
}

async function stopLegacyService() {
  // Paused first, so a late event from an old hook cannot start it again.
  await atomicJson(join(legacyHome(), "paused.json"), true);
  const record = readLocalJson(join(legacyHome(), "runtime.json"));
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(record?.origin || "") || !record.token) return;
  await fetch(`${record.origin}/api/shutdown`, { method: "POST", headers: { Authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(1500) }).catch(() => {});
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${record.origin}/api/health`, { signal: AbortSignal.timeout(300) }); } catch { return; }
    await delay(50);
  }
}

async function retireLegacyHome() {
  await mkdir(join(legacyHome(), "hooks"), { recursive: true, mode: 0o700 });
  for (const [old, current] of LEGACY_LAUNCHERS) {
    const path = join(legacyHome(), "hooks", old);
    const target = pathToFileURL(join(daemonwoodHome(), "hooks", current)).href;
    await writeFile(`${path}.tmp`, `// Daemonwood was called The Patch; this forwards an old hook path.\ntry { await import(${JSON.stringify(target)}); } catch {}\n`, { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  for (const name of ["versions", "install.json", "runtime.json", "service.log"]) await rm(join(legacyHome(), name), { recursive: true, force: true });
}

export async function launch(options = {}) {
  const before = installation();
  const legacy = await hasLegacyInstall();
  if (legacy) await adoptLegacyFaces();
  // Settings now point here, and the old hooks are replaced (claude-setup
  // still recognises their file names).
  const installed = await installRuntime(options);
  if (legacy) await stopLegacyService();
  try {
    const health = await ensureRunning({ resume: true });
    if (legacy) await retireLegacyHome();
    await pruneVersions().catch(() => {});
    return health;
  } catch (error) {
    // The old runtime is still whole; let it serve the sessions that call it.
    if (legacy) await atomicJson(join(legacyHome(), "paused.json"), false).catch(() => {});
    if (before && before.build !== installed.build) {
      await atomicJson(join(daemonwoodHome(), "install.json"), before);
      await ensureRunning({ resume: true }).catch(() => {});
      throw new Error(`${error.message} The previous runtime was restored.`);
    }
    throw error;
  }
}

export async function diagnose() {
  const installed = installation();
  const health = await serviceHealth();
  const problems = [];
  let claudeVersion = null;
  try { claudeVersion = await detectClaude(); } catch (e) { problems.push(e.message); }
  if (!installed) problems.push("Not installed. Run the launch command.");
  else {
    for (const file of [installed.nodePath, join(installed.root, "server.mjs"), hookOptions().adapterPath]) {
      try { await access(file); } catch { problems.push("An installed runtime path is missing. Run repair."); }
    }
    const file = join(installed.claudeDirectory, "settings.json");
    try {
      const settings = JSON.parse(await readFile(file, "utf8"));
      const inspection = inspectDaemonwoodHooks(settings, hookOptions());
      if (inspection.missing.length) problems.push("Claude Code setup is incomplete. Run repair.");
      if (settings.disableAllHooks) problems.push("Claude Code hooks are disabled in user settings.");
      const exact = Object.values(settings.hooks || {}).flatMap(groups => Array.isArray(groups) ? groups.flatMap(g => g.hooks || []) : []).filter(h => h.args?.includes(hookOptions().adapterPath));
      if (exact.some(h => h.command !== installed.nodePath)) problems.push("A hook uses an outdated Node path. Run repair.");
    } catch { problems.push(`Claude settings cannot be read: ${file}`); }
  }
  if (!health) problems.push(isPaused() ? "Paused. Run the launch command to resume." : "The local service is stopped. Run the launch command.");
  return { installed: Boolean(installed), version: installed?.version, claudeVersion, health, paused: isPaused(), problems: [...new Set(problems)] };
}

export async function uninstallRuntime() {
  return withLock(join(daemonwoodHome(), "install.lock"), async () => {
    const installed = installation();
    await stopService();
    if (installed) await editSettings(join(installed.claudeDirectory, "settings.json"), value => removeDaemonwoodStatusLine(removeDaemonwoodHooks(value, hookOptions()), hookOptions()));
    for (const name of ["hooks", "versions", "install.json", "runtime.json", "service.log"]) await rm(join(daemonwoodHome(), name), { recursive: true, force: true });
    // The forwarders a migration left behind, never a live old install.
    if (!setting("HOME") && !await hasLegacyInstall()) {
      for (const [old] of LEGACY_LAUNCHERS) await rm(join(legacyHome(), "hooks", old), { force: true });
    }
  });
}

export async function openBrowser(origin) {
  try {
    await runFile(process.platform === "darwin" ? "open" : "xdg-open", [origin], { timeout: 3000 });
    return true;
  } catch { return false; }
}

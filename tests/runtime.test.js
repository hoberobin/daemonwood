import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, chmod, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { editSettings, withLock } from "../scripts/local-files.mjs";
import { payload, payloadFiles } from "../scripts/package-files.mjs";
import { commandFor } from "../scripts/runtime.mjs";
import { displayCommand } from "../src/local-paths.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);
const scratch = () => mkdtemp(join(tmpdir(), "daemonwood runtime '"));

test("npm's file list and the durable installer ship the same payload", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const normalize = (list) => list.map((entry) => entry.replace(/\/$/, "")).filter((entry) => entry !== "package.json").sort();
  assert.deepEqual(normalize(pkg.files), normalize(payload));
  const files = await payloadFiles(root);
  assert.ok(files.includes("bin/daemonwood.mjs") && files.includes("scripts/daemon.mjs"));
  assert.ok(!files.some((file) => /^(art|docs|tests|\.claude|\.vscode)\//.test(file)), "source art, docs and tests stay out of the package");
});

/* The published package is the product's front door: `npx daemonwood wake`.
   npm 11 silently drops a bin path written "./bin/…" at publish time, and a
   prerelease published without the latest tag is invisible to a bare npx. */
test("the package publishes the daemonwood command where npx looks for it", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "daemonwood");
  assert.ok(!pkg.private, "a private package cannot be published");
  assert.deepEqual(pkg.bin, { daemonwood: "bin/daemonwood.mjs" });
  assert.equal(pkg.publishConfig?.tag, "latest");
  assert.ok(!pkg.dependencies && !pkg.devDependencies, "nothing to install but the package itself");
});

test("next-step commands are named the way the person launched", () => {
  assert.equal(commandFor("status", { npm_command: "exec" }, []), "npx daemonwood status");
  assert.equal(commandFor("sleep", {}, ["node", "/usr/local/bin/daemonwood"]), "daemonwood sleep");
  assert.equal(commandFor("sleep", { npm_lifecycle_script: "node bin/daemonwood.mjs" }, ["node", "bin/daemonwood.mjs"]), "npm run stop");
  assert.equal(commandFor("repair", { DAEMONWOOD_COMMAND: "~/.daemonwood/bin/daemonwood", npm_command: "exec" }, []), "~/.daemonwood/bin/daemonwood repair");
  assert.equal(displayCommand("/opt/it's here/daemonwood"), "'/opt/it'\\''s here/daemonwood'");
});

test("settings edits refuse invalid JSON without touching the file", async () => {
  const dir = await scratch();
  const file = join(dir, "settings.json");
  await writeFile(file, "{ not json");
  await assert.rejects(editSettings(file, (value) => ({ ...value, x: 1 })), /invalid JSON/);
  assert.equal(await readFile(file, "utf8"), "{ not json");
  await rm(dir, { recursive: true, force: true });
});

test("settings edits keep every key they were not asked to change", async () => {
  const dir = await scratch();
  const file = join(dir, "settings.json");
  await writeFile(file, JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, model: "opus" }));
  await editSettings(file, (value) => ({ ...value, statusLine: { type: "command", command: "x" } }));
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(next.permissions, { allow: ["Bash(ls)"] });
  assert.equal(next.model, "opus");
  assert.equal(next.statusLine.command, "x");
  await rm(dir, { recursive: true, force: true });
});

test("a lock left by a dead process is recovered; a live owner is waited for", async () => {
  const dir = await scratch();
  const lock = join(dir, "service.lock");
  await mkdir(lock);
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 2 ** 22 + 12345, id: "gone" }));
  assert.equal(await withLock(lock, async () => "ran"), "ran");
  await mkdir(lock);
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, id: "someone-else" }));
  await assert.rejects(withLock(lock, async () => "ran", 200), /still running/);
  await rm(dir, { recursive: true, force: true });
});

/* The whole first minute, end to end, in throwaway directories: a fake
   `claude` on PATH, a Claude profile whose path has a space and an apostrophe,
   other tools' settings that must survive, and no browser. */
test("launch, status, stop, relaunch and uninstall leave other settings intact", { timeout: 60_000 }, async () => {
  const dir = await scratch();
  const bin = join(dir, "bin");
  const claude = join(dir, "claude's profile");
  const home = join(dir, "daemonwood home");
  await mkdir(bin);
  await mkdir(claude);
  await writeFile(join(bin, "claude"), "#!/bin/sh\necho '2.1.0 (Claude Code)'\n");
  await chmod(join(bin, "claude"), 0o755);
  const original = { permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo other" }] }] },
    statusLine: { type: "command", command: "echo mine" } };
  await writeFile(join(claude, "settings.json"), JSON.stringify(original));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DAEMONWOOD_HOME: home, CLAUDE_CONFIG_DIR: claude, DAEMONWOOD_PORT: "0" };
  const cli = (...args) => run(process.execPath, [join(root, "bin/daemonwood.mjs"), ...args], { env, cwd: dir, timeout: 20_000 });
  try {
    const launched = await cli("--no-open");
    assert.match(launched.stdout, /Daemonwood is awake at http:\/\/127\.0\.0\.1:\d+/);
    const own = join(home, "bin/daemonwood");
    const viaOwn = JSON.parse((await run(own, ["status", "--json"], { env: { ...env, DAEMONWOOD_HOME: "", CLAUDE_CONFIG_DIR: "" }, cwd: dir, timeout: 20_000 })).stdout);
    assert.deepEqual(viaOwn.problems, [], "the installed command finds its own home and profile from anywhere");
    const settings = JSON.parse(await readFile(join(claude, "settings.json"), "utf8"));
    assert.equal(settings.hooks.SessionStart[0].hooks[0].args[0], join(home, "hooks/daemonwood-hook.mjs"), "hooks point at the durable launcher");
    assert.equal(settings.hooks.Stop.length, 2, "another tool's hook is kept beside ours");
    assert.deepEqual(settings.statusLine, original.statusLine, "an existing status line is left alone by default");

    const report = JSON.parse((await cli("status", "--json")).stdout);
    assert.equal(report.installed, true);
    assert.ok(report.health?.origin);
    assert.deepEqual(report.problems, []);

    await cli("stop");
    await assert.rejects(fetch(`${report.health.origin}/api/health`, { signal: AbortSignal.timeout(500) }));
    await mkdir(join(home, "versions", "0.0.1-stale"), { recursive: true });
    assert.match((await cli("wake", "up", "--no-open")).stdout, /is awake/, "waking again resumes a paused Daemonwood");
    const installed = JSON.parse(await readFile(join(home, "install.json"), "utf8"));
    assert.deepEqual(await readdir(join(home, "versions")), [installed.build], "old runtimes are pruned after a healthy launch");

    await cli("uninstall");
    assert.deepEqual(JSON.parse(await readFile(join(claude, "settings.json"), "utf8")), original);
    assert.deepEqual((await readdir(home)).filter((name) => !["paused.json", "familiars.json"].includes(name)), []);
  } finally {
    await cli("stop").catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

/* Upgrading from before the rename: a ~/.the-patch install with a running
   service, remembered faces and hooks in the Claude profile. One launch must
   bring the faces across, stop the old service, leave only the new hooks, and
   turn the old launchers into forwarders for sessions still holding them. */
test("the first launch after the rename adopts and retires a ~/.the-patch install", { timeout: 60_000 }, async () => {
  const dir = await scratch();
  const bin = join(dir, "bin");
  const claude = join(dir, ".claude");
  const legacy = join(dir, ".the-patch");
  const home = join(dir, ".daemonwood");
  await mkdir(bin);
  await mkdir(claude);
  await mkdir(join(legacy, "hooks"), { recursive: true });
  await mkdir(join(legacy, "versions", "0.15.0-old"), { recursive: true });
  await writeFile(join(bin, "claude"), "#!/bin/sh\necho '2.1.0 (Claude Code)'\n");
  await chmod(join(bin, "claude"), 0o755);

  let shutdowns = 0;
  const { createServer } = await import("node:http");
  const old = createServer((request, response) => {
    if (request.url === "/api/shutdown") { shutdowns++; response.end("{}"); old.close(); old.closeAllConnections(); return; }
    response.end("{}");
  });
  await new Promise((resolve) => old.listen(0, "127.0.0.1", resolve));
  const oldAdapter = join(legacy, "hooks/patch-hook.mjs");
  const faces = { version: 1, sessions: { abc: { name: "Moss" } } };
  await writeFile(join(legacy, "familiars.json"), JSON.stringify(faces));
  await writeFile(join(legacy, "install.json"), JSON.stringify({ version: "0.15.0-beta.1", build: "0.15.0-old", claudeDirectory: claude }));
  await writeFile(join(legacy, "runtime.json"), JSON.stringify({ origin: `http://127.0.0.1:${old.address().port}`, token: "old-token" }));
  await writeFile(oldAdapter, "// the old launcher\n");
  const other = { type: "command", command: "echo other" };
  await writeFile(join(claude, "settings.json"), JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "/old/node", args: [oldAdapter], timeout: 2 }] }],
    Stop: [{ hooks: [other] }, { hooks: [{ type: "command", command: "/old/node", args: [oldAdapter], timeout: 2 }] }]
  } }));

  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: dir, CLAUDE_CONFIG_DIR: claude, DAEMONWOOD_PORT: "0" };
  for (const name of ["DAEMONWOOD_HOME", "PATCH_HOME"]) delete env[name];
  const cli = (...args) => run(process.execPath, [join(root, "bin/daemonwood.mjs"), ...args], { env, cwd: dir, timeout: 20_000 });
  try {
    assert.match((await cli("--no-open")).stdout, /Daemonwood is awake/);
    assert.equal(shutdowns, 1, "the old service was asked to stop");
    assert.deepEqual(JSON.parse(await readFile(join(home, "familiars.json"), "utf8")), faces, "remembered faces came across");

    const settings = JSON.parse(await readFile(join(claude, "settings.json"), "utf8"));
    const handlers = Object.values(settings.hooks).flat().flatMap((group) => group.hooks);
    assert.ok(!handlers.some((handler) => handler.args?.includes(oldAdapter)), "no hook points at the old launcher");
    assert.ok(handlers.some((handler) => handler.args?.[0] === join(home, "hooks/daemonwood-hook.mjs")));
    assert.ok(handlers.some((handler) => handler.command === "echo other"), "another tool's hook is kept");

    assert.match(await readFile(oldAdapter, "utf8"), /daemonwood-hook\.mjs/, "the old launcher forwards to the new one");
    assert.equal(JSON.parse(await readFile(join(legacy, "paused.json"), "utf8")), true);
    assert.deepEqual((await readdir(legacy)).sort(), ["familiars.json", "hooks", "paused.json"], "the old runtime is gone");

    await cli("uninstall");
    assert.deepEqual(await readdir(join(legacy, "hooks")), [], "uninstall also removes the forwarders");
  } finally {
    await cli("stop").catch(() => {});
    old.close();
    await rm(dir, { recursive: true, force: true });
  }
});

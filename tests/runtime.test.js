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

const root = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);
const scratch = () => mkdtemp(join(tmpdir(), "patch runtime '"));

test("npm's file list and the durable installer ship the same payload", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const normalize = (list) => list.map((entry) => entry.replace(/\/$/, "")).filter((entry) => entry !== "package.json").sort();
  assert.deepEqual(normalize(pkg.files), normalize(payload));
  const files = await payloadFiles(root);
  assert.ok(files.includes("bin/the-patch.mjs") && files.includes("scripts/daemon.mjs"));
  assert.ok(!files.some((file) => /^(art|docs|tests|\.claude|\.vscode)\//.test(file)), "source art, docs and tests stay out of the package");
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
  const home = join(dir, "patch home");
  await mkdir(bin);
  await mkdir(claude);
  await writeFile(join(bin, "claude"), "#!/bin/sh\necho '2.1.0 (Claude Code)'\n");
  await chmod(join(bin, "claude"), 0o755);
  const original = { permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo other" }] }] },
    statusLine: { type: "command", command: "echo mine" } };
  await writeFile(join(claude, "settings.json"), JSON.stringify(original));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PATCH_HOME: home, CLAUDE_CONFIG_DIR: claude, PATCH_PORT: "0" };
  const cli = (...args) => run(process.execPath, [join(root, "bin/the-patch.mjs"), ...args], { env, cwd: dir, timeout: 20_000 });
  try {
    const launched = await cli("--no-open");
    assert.match(launched.stdout, /The Patch is ready at http:\/\/127\.0\.0\.1:\d+/);
    const settings = JSON.parse(await readFile(join(claude, "settings.json"), "utf8"));
    assert.equal(settings.hooks.SessionStart[0].hooks[0].args[0], join(home, "hooks/patch-hook.mjs"), "hooks point at the durable launcher");
    assert.equal(settings.hooks.Stop.length, 2, "another tool's hook is kept beside ours");
    assert.deepEqual(settings.statusLine, original.statusLine, "an existing status line is left alone by default");

    const report = JSON.parse((await cli("status", "--json")).stdout);
    assert.equal(report.installed, true);
    assert.ok(report.health?.origin);
    assert.deepEqual(report.problems, []);

    await cli("stop");
    await assert.rejects(fetch(`${report.health.origin}/api/health`, { signal: AbortSignal.timeout(500) }));
    await mkdir(join(home, "versions", "0.0.1-stale"), { recursive: true });
    assert.match((await cli("--no-open")).stdout, /is ready/, "launching again resumes a paused Patch");
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

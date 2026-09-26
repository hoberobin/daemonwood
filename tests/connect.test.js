import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  claudeInstalled,
  parseArguments,
  resolveTarget,
  run,
  scopeLabel,
  printReport
} from "../scripts/connect.mjs";
import { CLAUDE_EVENTS } from "../scripts/claude-setup.mjs";

test("a bare connect takes every project, a path narrows it to one", () => {
  assert.deepEqual(parseArguments([]), { projectDirectory: null, statusLine: true });
  assert.deepEqual(parseArguments(["--all"]), { projectDirectory: null, statusLine: true });
  assert.deepEqual(parseArguments(["/tmp/x"]), { projectDirectory: "/tmp/x", statusLine: true });
  assert.deepEqual(parseArguments(["--no-statusline"]), { projectDirectory: null, statusLine: false });
  assert.throws(() => parseArguments(["--codex"]), /Unknown option/);
  assert.throws(() => parseArguments(["/a", "/b"]), /at most one project/);
});

test("without a named project the install lands in the home directory", () => {
  const everywhere = resolveTarget({ home: "/home/dev" });
  assert.deepEqual(everywhere, { directory: "/home/dev", scope: "everywhere" });
  assert.equal(scopeLabel(everywhere), "every project");
});

test("a named project scopes the install to that repo", () => {
  const scoped = resolveTarget({ projectDirectory: "/work/thing", home: "/home/dev" });
  assert.deepEqual(scoped, { directory: "/work/thing", scope: "project" });
  assert.equal(scopeLabel(scoped), "thing");
});

test("Claude Code is detected from its home directory or from PATH", async () => {
  const home = await mkdtemp(join(tmpdir(), "patch-detect-"));
  const bin = await mkdtemp(join(tmpdir(), "patch-bin-"));
  assert.equal(claudeInstalled({ home, pathEntries: [] }), false);

  await mkdir(join(home, ".claude"));
  assert.equal(claudeInstalled({ home, pathEntries: [] }), true);

  const bare = await mkdtemp(join(tmpdir(), "patch-bare-"));
  await writeFile(join(bin, "claude"), "#!/bin/sh\n");
  assert.equal(claudeInstalled({ home: bare, pathEntries: [bin] }), true);
});

test("connect, status and disconnect round-trip a real settings file", async () => {
  const project = await mkdtemp(join(tmpdir(), "patch-connect-"));
  const target = { directory: project, scope: "project" };

  const connected = await run("connect", target);
  assert.equal(connected.ok, true);
  assert.equal(connected.configured, CLAUDE_EVENTS.length);
  assert.deepEqual(connected.missing, []);
  assert.match(connected.file, /\.claude[\\/]settings\.local\.json$/);

  const status = await run("status", target);
  assert.equal(status.ok, true);

  const removed = await run("disconnect", target);
  assert.equal(removed.configured, 0);

  // Status after disconnect must report the truth, not the last thing we did.
  const after = await run("status", target);
  assert.equal(after.ok, false);
  assert.deepEqual(after.missing, [...CLAUDE_EVENTS]);
});

test("connecting every project writes the user's settings.json and clears the old file", async () => {
  const home = await mkdtemp(join(tmpdir(), "patch-connect-home-"));
  await mkdir(join(home, ".claude"));
  const legacy = join(home, ".claude", "settings.local.json");
  const { addPatchHooks } = await import("../scripts/claude-setup.mjs");
  await writeFile(legacy, JSON.stringify(addPatchHooks({ other: 1 })));

  const connected = await run("connect", { directory: home, scope: "everywhere" }, { home });
  assert.equal(connected.ok, true);
  assert.equal(connected.file, join(home, ".claude", "settings.json"));
  assert.equal(connected.legacy.removed, CLAUDE_EVENTS.length);
  const { readFile } = await import("node:fs/promises");
  assert.deepEqual(JSON.parse(await readFile(legacy, "utf8")), { other: 1 });
  const user = JSON.parse(await readFile(connected.file, "utf8"));
  assert.equal(Object.keys(user.hooks).length, CLAUDE_EVENTS.length);
  assert.equal(user.statusLine.type, "command", "hooks and status line share the one file Claude Code reads");

  assert.equal((await run("status", { directory: home, scope: "everywhere" }, { home })).ok, true);
  const removed = await run("disconnect", { directory: home, scope: "everywhere" }, { home });
  assert.equal(removed.configured, 0);
  assert.equal("hooks" in JSON.parse(await readFile(connected.file, "utf8")), false);
});

test("an unreachable directory is reported, never thrown at the user", async () => {
  const record = await run("connect", { directory: "/nope/not/a/real/place", scope: "project" });
  assert.ok(record.error, "a failed install must come back as a record");
  assert.equal(record.ok, undefined);
});

/* The report is the only thing most people ever see of connect, so it must
   never be the thing that throws. Every shape it can be handed prints. */
test("every report shape prints without throwing", () => {
  const lines = [];
  const original = console.log;
  console.log = (value = "") => lines.push(String(value));
  try {
    const target = { directory: "/home/dev", scope: "everywhere" };
    const base = { target, file: "/home/dev/.claude/settings.json", configured: 12, total: 12, missing: [], ok: true, legacy: { legacyFile: "/home/dev/.claude/settings.local.json", removed: 12 } };
    printReport({ ...base, statusLine: { settingsFile: "/home/dev/.claude/settings.json", active: true, wraps: "npx ccstatusline" } }, "connect", { sessions: 2, refusedEvents: 0 });
    printReport({ ...base, statusLine: { skipped: true } }, "connect", null, { installed: false });
    printReport({ ...base, statusLine: { settingsFile: "/x", active: false, wraps: null } }, "status", { sessions: 0, refusedEvents: 1, lastRefusal: { reason: "no live process 9" } });
    printReport({ ...base, statusLine: { settingsFile: "/x", active: false } }, "disconnect", null);
    printReport({ ...base, missing: ["Stop"], ok: false, configured: 11 }, "connect", null);
    printReport({ target, error: "boom" }, "connect", null);
  } finally {
    console.log = original;
  }
  const output = lines.join("\n");
  assert.match(output, /Status line\s+shows each session's familiar/);
  assert.match(output, /In front of: npx ccstatusline/);
  assert.match(output, /left alone \(--no-statusline\)/);
  assert.match(output, /Status line\s+restored/);
  assert.match(output, /Not installed: Stop/);
  assert.match(output, /Removed 12 stale handlers/);
  assert.match(output, /boom/);
});

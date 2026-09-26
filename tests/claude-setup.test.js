import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_EVENTS,
  addDaemonwoodHooks,
  addDaemonwoodStatusLine,
  cleanLegacyUserLocal,
  check,
  inspectDaemonwoodHooks,
  inspectDaemonwoodStatusLine,
  install,
  installStatusLine,
  removeDaemonwoodHooks,
  removeDaemonwoodStatusLine,
  uninstall,
  uninstallStatusLine,
  unwrapStatusLine
} from "../scripts/claude-setup.mjs";

const options = { nodePath: "/test/node", adapterPath: "/test/daemonwood-hook.mjs" };

test("Claude hook installation preserves settings and is idempotent", () => {
  const existing = {
    permissions: { allow: ["Read"] },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./existing.sh" }] }] }
  };
  const once = addDaemonwoodHooks(existing, options);
  const twice = addDaemonwoodHooks(once, options);
  assert.deepEqual(twice, once);
  assert.deepEqual(once.permissions, existing.permissions);
  assert.equal(once.hooks.PreToolUse[0].hooks[0].command, "./existing.sh");
  assert.deepEqual(inspectDaemonwoodHooks(once, options).missing, []);
});

test("reinstall replaces a stale adapter path after Daemonwood moves", () => {
  const oldOptions = { nodePath: "/old/node", adapterPath: "/old/daemonwood/hooks/daemonwood-hook.mjs" };
  const moved = addDaemonwoodHooks(addDaemonwoodHooks({}, oldOptions), options);
  for (const eventName of CLAUDE_EVENTS) {
    const handlers = moved.hooks[eventName].flatMap((group) => group.hooks);
    assert.equal(handlers.length, 1);
    assert.equal(handlers[0].args[0], options.adapterPath);
  }
});

test("reinstall replaces the hooks and status line installed under the old name", () => {
  const legacy = addDaemonwoodStatusLine(
    addDaemonwoodHooks({}, { nodePath: "/old/node", adapterPath: "/home/me/.the-patch/hooks/patch-hook.mjs" }),
    { nodePath: "/old/node", statusLinePath: "/checkout/hooks/patch-statusline.mjs" }
  );
  legacy.statusLine = addDaemonwoodStatusLine({ statusLine: { type: "command", command: "echo mine" } },
    { nodePath: "/old/node", statusLinePath: "/checkout/hooks/patch-statusline.mjs" }).statusLine;
  const statusOptions = { ...options, statusLinePath: "/test/daemonwood-statusline.mjs" };
  const renamed = addDaemonwoodStatusLine(addDaemonwoodHooks(legacy, options), statusOptions);
  for (const eventName of CLAUDE_EVENTS) {
    const handlers = renamed.hooks[eventName].flatMap((group) => group.hooks);
    assert.deepEqual(handlers.map((handler) => handler.args[0]), [options.adapterPath]);
  }
  assert.doesNotMatch(renamed.statusLine.command, /patch-statusline/);
  assert.deepEqual(unwrapStatusLine(renamed.statusLine, statusOptions), { type: "command", command: "echo mine" },
    "the status line that was wrapped under the old name is still carried underneath");
});

test("Claude hook removal removes only Daemonwood handlers", () => {
  const installed = addDaemonwoodHooks({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "./keep-me.sh" }] }] }
  }, options);
  const removed = removeDaemonwoodHooks(installed, options);
  assert.equal(removed.hooks.Stop[0].hooks[0].command, "./keep-me.sh");
  assert.equal(inspectDaemonwoodHooks(removed, options).configured.length, 0);
});

test("project-local install and uninstall round-trip valid JSON", async () => {
  const project = await mkdtemp(join(tmpdir(), "daemonwood-claude-test-"));
  const installed = await install(project, options);
  assert.equal(installed.configured.length, CLAUDE_EVENTS.length);
  const saved = JSON.parse(await readFile(installed.settingsFile, "utf8"));
  assert.equal(saved.hooks.SessionStart[0].hooks[0].args[0], options.adapterPath);

  const removed = await uninstall(project, options);
  assert.equal(removed.configured.length, 0);
  assert.deepEqual(JSON.parse(await readFile(removed.settingsFile, "utf8")), {});
});

test("reinstalling only rewrites settings when the hooks really differ", async () => {
  const directory = await mkdtemp(join(tmpdir(), "daemonwood-claude-changed-"));
  const options = { nodePath: "/test/node", adapterPath: "/test/hooks/daemonwood-hook.mjs" };

  assert.equal((await install(directory, options)).changed, true);
  assert.equal((await install(directory, options)).changed, false);
  assert.equal((await install(directory, { ...options, nodePath: "/other/node" })).changed, true);
});

/* Claude Code reads hooks from three files, and the binary names them:
   ~/.claude/settings.json, <project>/.claude/settings.json and
   <project>/.claude/settings.local.json. A user-level settings.local.json is
   read by nothing — and was where "every project" used to be installed. */
test("the user-wide install goes in the file Claude Code actually reads", async () => {
  const home = await mkdtemp(join(tmpdir(), "daemonwood-home-scope-"));
  const installed = await install(home, { ...options, scope: "everywhere" });
  assert.equal(installed.settingsFile, join(home, ".claude", "settings.json"));
  assert.equal(installed.configured.length, CLAUDE_EVENTS.length);
  assert.equal((await check(home, { ...options, scope: "everywhere" })).missing.length, 0);
  const saved = JSON.parse(await readFile(installed.settingsFile, "utf8"));
  assert.equal(saved.hooks.Stop[0].hooks[0].args[0], options.adapterPath);

  // The project install still lands in the project's own local file.
  const project = await mkdtemp(join(tmpdir(), "daemonwood-project-scope-"));
  assert.match((await install(project, options)).settingsFile, /\.claude[\/]settings\.local\.json$/);
});

test("handlers left in the file nothing reads are cleaned out, and nothing else is touched", async () => {
  const home = await mkdtemp(join(tmpdir(), "daemonwood-legacy-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(home, ".claude"));
  const legacy = join(home, ".claude", "settings.local.json");
  const stale = addDaemonwoodHooks({ permissions: { allow: ["Read"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "./mine.sh" }] }] } }, options);
  await writeFile(legacy, JSON.stringify(stale));

  const cleaned = await cleanLegacyUserLocal({ home, ...options });
  assert.equal(cleaned.removed, CLAUDE_EVENTS.length);
  const after = JSON.parse(await readFile(legacy, "utf8"));
  assert.deepEqual(after, { permissions: { allow: ["Read"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "./mine.sh" }] }] } });
  assert.equal((await cleanLegacyUserLocal({ home, ...options })).removed, 0);
  assert.equal((await cleanLegacyUserLocal({ home: join(home, "nowhere"), ...options })).removed, 0, "no file, nothing to do");
});

/* A hook this version no longer listens to must not keep firing from an older
   install: TaskCreated and TaskCompleted cost a node process each and told the
   map about helpers that did not exist. */
test("reinstalling strips handlers for events no longer subscribed to", () => {
  const stale = addDaemonwoodHooks({}, options);
  stale.hooks.TaskCreated = [{ hooks: [{ type: "command", command: options.nodePath, args: [options.adapterPath], timeout: 2 }] }];
  stale.hooks.TaskCompleted = [{ hooks: [{ type: "command", command: "./theirs.sh" }, { type: "command", command: options.nodePath, args: [options.adapterPath], timeout: 2 }] }];
  const healed = addDaemonwoodHooks(stale, options);
  assert.equal("TaskCreated" in healed.hooks, false);
  assert.deepEqual(healed.hooks.TaskCompleted, [{ hooks: [{ type: "command", command: "./theirs.sh" }] }]);
  assert.ok(!CLAUDE_EVENTS.includes("TaskCreated") && !CLAUDE_EVENTS.includes("TaskCompleted"));
});

test("a moved node binary is corrected instead of left to fail silently", () => {
  const stale = addDaemonwoodHooks({}, { nodePath: "/old/node", adapterPath: "/test/daemonwood-hook.mjs" });
  assert.equal(stale.hooks.Stop[0].hooks[0].command, "/old/node");

  const healed = addDaemonwoodHooks(stale, { nodePath: "/new/node", adapterPath: "/test/daemonwood-hook.mjs" });
  const handlers = healed.hooks.Stop.flatMap((group) => group.hooks);
  assert.equal(handlers.length, 1, "the stale handler must be replaced, not joined");
  assert.equal(handlers[0].command, "/new/node");
});

const statusOptions = { nodePath: "/test/node", statusLinePath: "/test/hooks/daemonwood-statusline.mjs" };

test("the status line wrapper keeps the previous status line running underneath, byte for byte", () => {
  const previous = { type: "command", command: "npx -y ccstatusline@latest | sed 's/\"a\"/b/'", padding: 0 };
  const wrapped = addDaemonwoodStatusLine({ statusLine: previous, model: "opus" }, statusOptions);
  assert.equal(wrapped.model, "opus");
  assert.equal(wrapped.statusLine.type, "command");
  assert.match(wrapped.statusLine.command, /^'\/test\/node' '\/test\/hooks\/daemonwood-statusline\.mjs' --then-b64 [A-Za-z0-9+/=]+$/);
  assert.equal(wrapped.statusLine.padding, 0);
  assert.deepEqual(unwrapStatusLine(wrapped.statusLine, statusOptions), previous);
  assert.deepEqual(inspectDaemonwoodStatusLine(wrapped, statusOptions), { active: true, wraps: previous.command });

  // Wrapping twice unwraps first: the same file, never a wrapper in a wrapper.
  assert.deepEqual(addDaemonwoodStatusLine(wrapped, statusOptions), wrapped);
  assert.deepEqual(removeDaemonwoodStatusLine(wrapped, statusOptions), { statusLine: previous, model: "opus" });
});

test("with no status line before, the wrapper stands alone and removal leaves none", () => {
  const wrapped = addDaemonwoodStatusLine({}, statusOptions);
  assert.equal(wrapped.statusLine.command, "'/test/node' '/test/hooks/daemonwood-statusline.mjs'");
  assert.equal(unwrapStatusLine(wrapped.statusLine, statusOptions), null);
  assert.deepEqual(removeDaemonwoodStatusLine(wrapped, statusOptions), {});
  assert.deepEqual(inspectDaemonwoodStatusLine({ statusLine: { type: "command", command: "other" } }, statusOptions), { active: false, wraps: null });
  assert.deepEqual(removeDaemonwoodStatusLine({ statusLine: { type: "command", command: "other" } }, statusOptions).statusLine.command, "other");
});

test("the status line is installed in the user's own settings and restored on uninstall", async () => {
  const home = await mkdtemp(join(tmpdir(), "daemonwood-home-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(home, ".claude"));
  await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "mine" }, other: true }));

  const installed = await installStatusLine({ home, ...statusOptions });
  assert.equal(installed.changed, true);
  assert.equal(installed.active, true);
  assert.equal(installed.wraps, "mine");
  assert.equal((await installStatusLine({ home, ...statusOptions })).changed, false);
  const saved = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(saved.other, true, "nothing but statusLine is touched");

  const removed = await uninstallStatusLine({ home, ...statusOptions });
  assert.equal(removed.active, false);
  assert.deepEqual(JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8")), { statusLine: { type: "command", command: "mine" }, other: true });
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noteForProcess, readSessionRegistry, registryEntryFor, sessionNameFor, START_SLACK_MS } from "../src/session-registry.js";

function registryFixture() {
  const root = mkdtempSync(join(tmpdir(), "patch-registry-"));
  writeFileSync(join(root, "30006.json"), JSON.stringify({
    pid: 30006, sessionId: "78cddc65-7041-4331-9d31-9a4a9f5f8dc4", cwd: "/Users/someone/work/app",
    messagingSocketPath: "/tmp/cc-socks/30006.sock", name: "work-app-6c", nameSource: "derived",
    startedAt: 1790359723289, procStart: "Fri Sep 25 18:08:42 2026", kind: "interactive",
    status: "waiting", waitingFor: "permission prompt", statusUpdatedAt: 1790359800976, updatedAt: 1790359800976
  }));
  writeFileSync(join(root, "31000.json"), JSON.stringify({ pid: 31000, sessionId: "spare-1", status: "idle", spare: true, startedAt: 1 }));
  writeFileSync(join(root, "42028.json"), JSON.stringify({ pid: 42028, sessionId: "s-renamed", name: "  growth\u0000 report  ", nameSource: "user" }));
  writeFileSync(join(root, "30006.deadbeef.key"), JSON.stringify({ peerToken: "never-read" }));
  writeFileSync(join(root, "99999.json"), "{ not json");
  return root;
}

test("the registry names each live session by pid, and only the name comes out", () => {
  const registry = readSessionRegistry({ root: registryFixture() });
  assert.deepEqual([...registry.keys()].sort(), [30006, 31000, 42028]);
  const entry = registry.get(30006);
  assert.equal(entry.sessionId, "78cddc65-7041-4331-9d31-9a4a9f5f8dc4");
  assert.equal(entry.name, "work-app-6c");
  assert.equal("messagingSocketPath" in entry, false, "the socket is not the map's business");
  assert.equal("cwd" in entry, false, "absolute paths stay on the machine");
  assert.equal(entry.repository, "app", "the project's name, never its path");
  assert.equal(entry.status, "waiting");
  assert.equal(entry.waitingFor, "permission prompt");
  assert.equal(entry.statusUpdatedAt, 1790359800976);
  assert.equal(entry.startedAt, 1790359723289);
  assert.equal(registry.get(42028).name, "growth report");
  assert.equal(registry.get(42028).status, null, "a status the bridge does not know is no status");
  assert.equal(registry.get(31000).spare, true);
});

/* A note is keyed by pid, and pids get reused. The note says when its process
   started; so does `ps`. They have to agree before the note counts. */
test("a note only speaks for the process that wrote it", () => {
  const registry = readSessionRegistry({ root: registryFixture() });
  const sameProcess = { pid: 30006, startedAt: "Fri Sep 25 11:08:42 2026" }; // local time of 1790359722000
  assert.equal(noteForProcess(30006, sameProcess, registry)?.sessionId, "78cddc65-7041-4331-9d31-9a4a9f5f8dc4");
  const laterProcess = { pid: 30006, startedAt: new Date(1790359723289 + START_SLACK_MS + 1_000).toString() };
  assert.equal(noteForProcess(30006, laterProcess, registry), null, "a reused pid gets no note");
  assert.equal(noteForProcess(30006, null, registry)?.sessionId, "78cddc65-7041-4331-9d31-9a4a9f5f8dc4", "no process to compare with: the note stands");
  assert.equal(noteForProcess(31000, { pid: 31000, startedAt: new Date(1).toString() }, registry), null, "a spare process is not a session");
  assert.equal(noteForProcess(30006, sameProcess, null), null);
});

test("a name is only lent to the session whose pid and id both match", () => {
  const registry = readSessionRegistry({ root: registryFixture() });
  assert.equal(sessionNameFor({ ownerPid: 30006, sessionId: "78cddc65-7041-4331-9d31-9a4a9f5f8dc4" }, registry), "work-app-6c");
  // Wearing a real pid with an invented id gets no name, the same way it gets no familiar.
  assert.equal(sessionNameFor({ ownerPid: 30006, sessionId: "invented" }, registry), null);
  assert.equal(registryEntryFor({ ownerPid: 12345, sessionId: "s-renamed" }, registry), null);
  assert.equal(sessionNameFor({ sessionId: "s-renamed" }, registry), null);
});

test("an unreadable registry says so, and names nobody", () => {
  assert.equal(readSessionRegistry({ root: join(tmpdir(), "patch-registry-does-not-exist") }), null);
  assert.equal(sessionNameFor({ ownerPid: 30006, sessionId: "x" }, null), null);
});

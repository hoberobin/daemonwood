import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { correctionFor, createPatchServer, discoverSessions, reapDeadSessions, verifyEventOwner } from "../src/event-server.js";
import { chooseFamiliar, FAMILIARS } from "../src/familiars.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/* Every test posts as a session the bridge can verify, because that is the only
   kind the bridge accepts. A test that skipped this would be testing a door
   that no longer exists. */
const OWNER_PID = 4242;
const OWNER_STARTED = "Thu Sep 24 10:00:01 2026";
const owner = { ownerPid: OWNER_PID, ownerStartedAt: OWNER_STARTED };
const liveClaude = () => [
  { pid: OWNER_PID, ppid: 1, startedAt: OWNER_STARTED, command: "claude --dangerously-skip-permissions" }
];
/* These tests are about the process door, so the session ledger is stubbed as
   unreadable: "cannot tell" must never be a refusal. The ledger has its own
   tests below, which hand it a real answer. */
const patchServer = (options = {}) =>
  createPatchServer({ root, processSnapshot: liveClaude, ledgerSnapshot: () => null, ...options });

test("bridge health and ingestion work without a live agent", async (t) => {
  const server = patchServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const before = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(before.ok, true);
  assert.equal(before.clients, 0);
  assert.equal(before.sessions, 0);
  assert.equal(before.receivedEvents, 0);
  assert.equal(before.lastEventAt, null);
  assert.ok(Date.parse(before.startedAt));

  const response = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "tool_started",
      category: "edit",
      sessionId: "fixture-1",
      agentName: "Fixture",
      ...owner,
      prompt: "must disappear",
      tool_input: { path: "/secret" }
    })
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.event.visualState, "editing");
  assert.equal("prompt" in body.event, false);
  assert.equal("tool_input" in body.event, false);

  const after = await fetch(`${base}/api/health`).then((result) => result.json());
  assert.equal(after.receivedEvents, 1);
  assert.equal(after.sessions, 1);
  assert.ok(Date.parse(after.lastEventAt));
});

test("bridge rejects unsupported events", async (t) => {
  const server = patchServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "unknown", sessionId: "fixture-2" })
  });
  assert.equal(response.status, 422);
});

test("a reconnecting browser receives the latest session snapshot", async (t) => {
  const server = patchServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "tool_started", category: "test", sessionId: "snapshot-1",
      agentName: "Explorer", timestamp: "2026-09-21T12:00:00.000Z", ...owner
    })
  });

  const controller = new AbortController();
  const response = await fetch(`${base}/api/events/stream`, { signal: controller.signal });
  const reader = response.body.getReader();
  let output = "";
  for (let count = 0; count < 4 && !output.includes("patch-snapshot"); count += 1) {
    const chunk = await reader.read();
    output += new TextDecoder().decode(chunk.value || new Uint8Array());
  }
  controller.abort();
  assert.match(output, /event: patch-snapshot/);
  assert.match(output, /"sessionId":"snapshot-1"/);
  assert.match(output, /"visualState":"testing"/);
});

test("ended sessions are removed from health and reconnect snapshots", async (t) => {
  const server = patchServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  await post({ type: "session_started", sessionId: "gone", ...owner });
  await post({ type: "session_ended", sessionId: "gone", ...owner });
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.sessions, 0);
});

test("an older end event cannot remove a newer snapshot", async (t) => {
  const server = patchServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });

  await post({ type: "tool_started", category: "edit", sessionId: "live", timestamp: "2026-09-24T12:00:02.000Z", ...owner });
  await post({ type: "session_ended", sessionId: "live", timestamp: "2026-09-24T12:00:01.000Z", ...owner });
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.sessions, 1);
});

test("the bridge removes a session when its owning CLI process dies", async (t) => {
  let processes = [{ pid: 4242, ppid: 1, startedAt: "Thu Sep 24 10:00:01 2026", command: "claude" }];
  const server = createPatchServer({ root, processSnapshot: () => processes, ledgerSnapshot: () => null, reapIntervalMs: 5 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "stopped", sessionId: "killed",
      ownerPid: 4242, ownerStartedAt: "Thu Sep 24 10:00:01 2026"
    })
  });
  assert.equal((await fetch(`${base}/api/health`).then((response) => response.json())).sessions, 1);

  processes = [];
  const deadline = Date.now() + 500;
  let health;
  do {
    health = await fetch(`${base}/api/health`).then((response) => response.json());
    if (health.sessions === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.equal(health.sessions, 0);
});

test("a later event without a project or task keeps the ones the session already gave", async () => {
  const server = patchServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });

  await post({
    sessionId: "keep", agentName: "Fern", ...owner,
    repository: "/Users/someone/work/level-chinese", taskLabel: "Audit the import pipeline",
    type: "tool_started", category: "search"
  });
  // A permission prompt carries no repository, and the sanitizer fills the gap
  // with "unlabeled-repo". That placeholder must not erase the real project.
  await post({ sessionId: "keep", agentName: "Fern", type: "permission_requested", ...owner });

  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.sessions, 1);

  const stream = await fetch(`${base}/api/events/stream`);
  const reader = stream.body.getReader();
  const chunk = new TextDecoder().decode((await reader.read()).value);
  const snapshot = JSON.parse(chunk.slice(chunk.indexOf("patch-snapshot\ndata: ") + 21, chunk.lastIndexOf("\n\n")));
  assert.equal(snapshot[0].repository, "level-chinese");
  assert.equal(snapshot[0].taskLabel, "Audit the import pipeline");
  assert.equal(snapshot[0].visualState, "needs_input");

  await reader.cancel();
  await new Promise((resolve) => server.close(resolve));
});

/* The regression that started this: five POSTs with no process behind them put
   a cast of demo familiars on a live map, one of them holding a permission
   prompt that no session was waiting on. */
test("the bridge refuses an event that cannot name a live Claude Code process", async (t) => {
  const server = patchServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });

  const seeded = await post({ type: "needs_input", sessionId: "demo-kettle", agentName: "kettle" });
  assert.equal(seeded.status, 403);
  assert.match((await seeded.json()).error, /no process identity/);

  const forged = await post({ type: "needs_input", sessionId: "demo-quill", agentName: "quill", ownerPid: 999_999 });
  assert.equal(forged.status, 403);
  assert.match((await forged.json()).error, /no live process/);

  const impostor = await post({ type: "tool_started", category: "edit", sessionId: "not-claude", ownerPid: 1234 });
  assert.equal(impostor.status, 403);

  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.sessions, 0, "nothing refused may reach the map");
  assert.equal(health.receivedEvents, 0, "a refusal is not an event received");
  assert.equal(health.refusedEvents, 3);
  assert.equal(health.lastRefusal.sessionId, "not-claude");
});

test("a refusal reaches the browser so silence can never pass for an empty workshop", async (t) => {
  const server = patchServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const stream = await fetch(`${base}/api/events/stream`);
  const reader = stream.body.getReader();
  await reader.read();

  await fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "needs_input", sessionId: "demo-kettle", agentName: "kettle" })
  });

  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("patch-refused")) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  assert.match(seen, /event: patch-refused/);
  assert.match(seen, /"sessionId":"demo-kettle"/);
  await reader.cancel();
});

test("verification answers the awkward cases the same way every time", () => {
  const processes = liveClaude();
  const alive = { sessionId: "real", ...owner };

  assert.equal(verifyEventOwner(alive, new Map(), { processes }).ok, true);

  // A `ps` that will not answer proves nothing; the reaper settles it later.
  assert.equal(verifyEventOwner(alive, new Map(), { processes: null }).ok, true);

  // A pid recycled by a later process is not the session that claimed it.
  const recycled = { sessionId: "real", ownerPid: OWNER_PID, ownerStartedAt: "Thu Sep 24 09:00:00 2026" };
  assert.equal(verifyEventOwner(recycled, new Map(), { processes }).ok, false);

  // A live pid that is not Claude Code cannot stand in for one.
  const other = [{ pid: OWNER_PID, ppid: 1, startedAt: OWNER_STARTED, command: "node seed.mjs" }];
  assert.equal(verifyEventOwner(alive, new Map(), { processes: other }).ok, false);

  /* A session's last word may outlive its process, but only for a session the
     bridge already knows by that pid, and only to remove it. */
  const known = new Map([["real", { sessionId: "real", ...owner }]]);
  const farewell = { sessionId: "real", ...owner, removesSession: true };
  assert.equal(verifyEventOwner(farewell, known, { processes: [] }).ok, true);
  assert.equal(verifyEventOwner({ ...farewell, sessionId: "stranger" }, known, { processes: [] }).ok, false);
  assert.equal(verifyEventOwner({ sessionId: "real", ...owner }, known, { processes: [] }).ok, false, "only removals get the exception");
});

test("a session is never evicted by silence, only by its process being gone", () => {
  const start = Date.parse("2026-09-21T12:00:00.000Z");
  const owned = {
    sessionId: "real", ownerPid: 4242,
    ownerStartedAt: "Mon Sep 21 09:00:00 2026",
    timestamp: new Date(start).toISOString()
  };
  const alive = [{ pid: 4242, ppid: 1, startedAt: "Mon Sep 21 09:00:00 2026", command: "claude" }];

  // Quiet for a week, but demonstrably running: it stays.
  const quiet = new Map([["real", owned]]);
  const later = () => new Date(start + 7 * 24 * 60 * 60_000);
  assert.equal(reapDeadSessions(quiet, alive, () => {}, later), 0);

  // A failed `ps` probe is not evidence of death, so it must not evict either.
  const unprobed = new Map([["real", owned]]);
  assert.equal(reapDeadSessions(unprobed, null, () => {}, later), 0);

  // The process actually being gone is the only thing that removes it.
  const dead = new Map([["real", owned]]);
  const removals = [];
  assert.equal(reapDeadSessions(dead, [], (event) => removals.push(event), later), 1);
  assert.equal(removals[0].type, "disconnected");
});

test("the stream beats so a dead connection cannot pass for a quiet workshop", async (t) => {
  const server = patchServer({ heartbeatIntervalMs: 20 });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${origin}/api/events/stream`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("patch-beat")) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  assert.match(seen, /event: patch-beat/);
  await reader.cancel();
});

/* The seeded demo cast, second attempt. The first one POSTed with no process
   behind it and the pid door stopped it. The second read `ps`, took the pids of
   four sessions that really were running, and walked straight in — four
   invented familiars, one of them standing at the Permission Gate asking for
   something nobody could grant. A pid proves a process, never a session. */
test("a borrowed pid cannot conjure a session Claude Code never opened", async (t) => {
  const ledger = new Set(["real-session"]);
  const server = patchServer({ ledgerSnapshot: () => ledger });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });

  const real = await post({ type: "tool_started", category: "edit", sessionId: "real-session", ...owner });
  assert.equal(real.status, 202);

  const seeded = await post({ type: "needs_input", sessionId: "seed-session-1", ...owner });
  assert.equal(seeded.status, 403);
  assert.match((await seeded.json()).error, /no session seed-session-1/);

  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.sessions, 1, "the invented familiar never reached the map");
});

test("one process speaks for one session", () => {
  const processes = liveClaude();
  const ledger = new Set(["real", "other"]);
  const taken = new Map([["real", { sessionId: "real", ...owner }]]);

  // The session already holding the pid keeps it.
  assert.equal(verifyEventOwner({ sessionId: "real", ...owner }, taken, { processes, ledger }).ok, true);

  // A second session wearing the same pid is being worn, not owned.
  const doubled = verifyEventOwner({ sessionId: "other", ...owner }, taken, { processes, ledger });
  assert.equal(doubled.ok, false);
  assert.match(doubled.reason, /already speaks for another session/);

  // A pid whose holder has died is free again: the reaper releases it.
  const dead = new Map([["real", { sessionId: "real", ownerPid: 99, ownerStartedAt: OWNER_STARTED }]]);
  assert.equal(verifyEventOwner({ sessionId: "other", ...owner }, dead, { processes, ledger }).ok, true);
});

test("an unreadable ledger proves nothing and costs nobody a familiar", () => {
  const processes = liveClaude();
  assert.equal(verifyEventOwner({ sessionId: "real", ...owner }, new Map(), { processes, ledger: null }).ok, true);
});

/* Claude Code writes a note per process the second it starts, naming the
   session it hosts. Its transcript appears at the first prompt — minutes
   later, sometimes. The bridge's own health log showed the author's session
   refused with "Claude Code has no session" eighty seconds after it opened,
   which is the map lying about the one session that mattered. */
const noteFor = (sessionId, extra = {}) => new Map([[OWNER_PID, {
  pid: OWNER_PID, sessionId, name: null, status: "busy", statusUpdatedAt: Date.parse("2026-09-24T10:00:05.000Z"),
  startedAt: Date.parse(OWNER_STARTED), spare: false, repository: "web-app", ...extra
}]]);

test("Claude Code's own note admits a session before its transcript exists", () => {
  const processes = liveClaude();
  const ledger = new Set(["some-old-session"]);
  const arriving = { sessionId: "brand-new", ...owner };
  assert.equal(verifyEventOwner(arriving, new Map(), { processes, ledger }).ok, false, "without a note the ledger still decides");
  assert.equal(verifyEventOwner(arriving, new Map(), { processes, ledger, registry: noteFor("brand-new") }).ok, true);
});

test("a borrowed pid with a real old session id is refused by the note", () => {
  const processes = liveClaude();
  const ledger = new Set(["old-but-real", "current"]);
  const forged = verifyEventOwner({ sessionId: "old-but-real", ...owner }, new Map(), { processes, ledger, registry: noteFor("current") });
  assert.equal(forged.ok, false);
  assert.match(forged.reason, /is hosting session current, not old-but-real/);
  assert.equal(forged.noteMismatch, true, "the door asks again before calling it a forgery");
});

test("a note left behind by an earlier life of the pid says nothing about this one", () => {
  const processes = liveClaude();
  const stale = noteFor("ghost", { startedAt: Date.parse(OWNER_STARTED) - 3 * 60_000 });
  // Ignored as proof for the ghost, ignored as a veto for the real one.
  assert.equal(verifyEventOwner({ sessionId: "real", ...owner }, new Map(), { processes, ledger: new Set(["real"]), registry: stale }).ok, true);
  assert.equal(discoverSessions(new Map(), processes, stale).length, 0);
});

/* `/clear` keeps the process and the terminal and hands them a new session
   id. Before, the new session was refused forever as an impostor and the old
   one stood on the map, Done, for the rest of the day. */
test("/clear hands the terminal to the new session and keeps its face", async (t) => {
  let registry = noteFor("first");
  const server = createPatchServer({ root, processSnapshot: liveClaude, ledgerSnapshot: () => null, registrySnapshot: () => registry, reapIntervalMs: 10_000 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });

  const first = await post({ type: "tool_started", category: "edit", sessionId: "first", terminalProgram: "iTerm", ...owner }).then((r) => r.json());
  registry = noteFor("second");
  const second = await post({ type: "session_started", sessionId: "second", ...owner });
  assert.equal(second.status, 202);
  const event = (await second.json()).event;
  assert.equal(event.familiarType, first.event.familiarType, "same terminal, same familiar");
  assert.equal(event.terminalProgram, "iTerm");
  const sessions = await fetch(`${base}/api/sessions`).then((r) => r.json());
  assert.deepEqual(sessions.map((session) => session.sessionId), ["second"]);
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.refusedEvents, 0);
});

test("a session that ended is not resurrected by the note its exiting process leaves behind", async (t) => {
  const registry = noteFor("leaving");
  const server = createPatchServer({ root, processSnapshot: liveClaude, ledgerSnapshot: () => null, registrySnapshot: () => registry, reapIntervalMs: 15 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal((await fetch(`${base}/api/sessions`).then((r) => r.json())).length, 1, "discovered while running");
  const bye = await fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "session_ended", sessionId: "leaving", ...owner })
  });
  assert.equal(bye.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal((await fetch(`${base}/api/sessions`).then((r) => r.json())).length, 0, "gone means gone");
});

test("the sweep retires a session whose process has moved on to another", () => {
  const sessions = new Map([["first", { sessionId: "first", ...owner, timestamp: "2026-09-24T12:00:00.000Z" }]]);
  const removals = [];
  assert.equal(reapDeadSessions(sessions, liveClaude(), (event) => removals.push(event), undefined, null, noteFor("first")), 0);
  assert.equal(reapDeadSessions(sessions, liveClaude(), (event) => removals.push(event), undefined, null, noteFor("second")), 1);
  assert.equal(removals[0].type, "superseded");
  assert.equal(removals[0].removesSession, true);
});

/* Claude Code's note also says, in its own words, whether the session is
   waiting on a dialog, busy, or idle. That closes the gaps hooks leave. */
test("the note corrects the map, and only when it is newer than the last hook", () => {
  const at = Date.parse("2026-09-24T12:00:00.000Z");
  const session = { sessionId: "s", ...owner, timestamp: new Date(at).toISOString(), visualState: "running", workCategory: "command", agentName: "Claude", repository: "app", taskLabel: "Unlabeled task" };
  const note = (status, delta) => ({ status, statusUpdatedAt: at + delta });

  // A permission granted: the dialog closes, no hook fires, the note says busy.
  const waiting = { ...session, visualState: "needs_input" };
  const resumed = correctionFor(waiting, note("busy", 5_000));
  assert.equal(resumed.type, "tool_started");
  assert.equal(resumed.category, "command", "back to the station it left, not a generic one");
  assert.equal(resumed.timestamp, new Date(at + 5_000).toISOString());

  // Escape interrupts a turn: no Stop hook, the note says idle.
  assert.equal(correctionFor(session, note("idle", 5_000)).type, "stopped");
  // A dialog the hooks missed.
  assert.equal(correctionFor(session, note("waiting", 5_000)).type, "needs_input");

  // Older than the last event, or the same age: the hooks already said it.
  assert.equal(correctionFor(session, note("idle", 0)), null);
  assert.equal(correctionFor(session, note("idle", -5_000)), null);
  // Agreement is silence.
  assert.equal(correctionFor(session, note("busy", 5_000)), null);
  assert.equal(correctionFor(waiting, note("waiting", 5_000)), null);
  // Idle leaves Starting and Done alone; busy leaves Starting alone.
  assert.equal(correctionFor({ ...session, visualState: "arriving" }, note("idle", 5_000)), null);
  assert.equal(correctionFor({ ...session, visualState: "finished" }, note("idle", 5_000)), null);
  assert.equal(correctionFor({ ...session, visualState: "arriving" }, note("busy", 5_000)), null);
  // Done, then the note says busy again: something resumed the turn.
  assert.equal(correctionFor({ ...session, visualState: "finished", workCategory: undefined }, note("busy", 5_000)).type, "prompt_submitted");
  assert.equal(correctionFor(session, { status: null }), null);
});

/* Claude Code writes `idle` into a new session's note the moment it starts.
   Before the first prompt there is no transcript, and that is the difference
   between a session that just opened and one that finished a turn. */
test("a discovered idle session with no transcript yet is Starting, not Done", () => {
  const processes = [{ pid: OWNER_PID, ppid: 1, tty: "ttys003", startedAt: OWNER_STARTED, command: "claude" }];
  const registry = new Map([
    [OWNER_PID, { pid: OWNER_PID, sessionId: "fresh", status: "idle", statusUpdatedAt: Date.parse("2026-09-24T10:00:09.000Z"), startedAt: Date.parse(OWNER_STARTED) }]
  ]);
  const discovered = (ledger) => discoverSessions(new Map(), processes, registry, { ledger })[0].visualState;
  assert.equal(discovered(new Set()), "arriving", "never prompted: at the workbench");
  assert.equal(discovered(new Set(["fresh"])), "finished", "a transcript means a turn has ended");
  assert.equal(discovered(null), "finished", "an unreadable ledger proves nothing");
});

/* A session that was running before the bridge was, or before the hooks were
   installed, is on the machine and therefore belongs on the map. */
test("sessions Claude Code is running are discovered from its notes, verified against ps", async (t) => {
  const processes = () => [
    { pid: OWNER_PID, ppid: 1, tty: "ttys003", startedAt: OWNER_STARTED, command: "claude" },
    { pid: 5151, ppid: 1, tty: "ttys004", startedAt: "Thu Sep 24 10:00:02 2026", command: "claude" }
  ];
  const registry = new Map([
    [OWNER_PID, { pid: OWNER_PID, sessionId: "running", status: "waiting", statusUpdatedAt: Date.parse("2026-09-24T10:00:09.000Z"), startedAt: Date.parse(OWNER_STARTED), spare: false, repository: "web-app", name: "web-app-1a" }],
    [5151, { pid: 5151, sessionId: null, status: "idle", statusUpdatedAt: 1, startedAt: Date.parse("Thu Sep 24 10:00:02 2026"), spare: false }],
    [7777, { pid: 7777, sessionId: "dead", status: "busy", statusUpdatedAt: 1, startedAt: 1, spare: false }]
  ]);
  const found = discoverSessions(new Map(), processes(), registry);
  assert.equal(found.length, 1, "no session id or no process means nothing to draw");
  // A session that just said goodbye is not brought back by the note its exiting process leaves behind.
  assert.equal(discoverSessions(new Map(), processes(), registry, { recentlyEnded: new Map([["running", Date.now()]]) }).length, 0);
  assert.equal(found[0].sessionId, "running");
  assert.equal(found[0].visualState, "needs_input");
  assert.equal(found[0].timestamp, "2026-09-24T10:00:09.000Z");
  assert.equal(found[0].repository, "web-app");
  assert.equal(found[0].ownerStartedAt, OWNER_STARTED);

  const server = createPatchServer({ root, processSnapshot: processes, ledgerSnapshot: () => null, registrySnapshot: () => registry, reapIntervalMs: 10_000 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessions = await fetch(`${base}/api/sessions`).then((r) => r.json());
  assert.equal(sessions.length, 1, "discovered the moment the bridge starts");
  assert.equal(sessions[0].sessionId, "running");
  assert.equal(sessions[0].visualState, "needs_input");
  assert.equal(sessions[0].sessionName, "web-app-1a");
  assert.equal(sessions[0].terminalTty, "ttys003");
  assert.ok(sessions[0].familiar?.name);
});

test("the reaper takes down a familiar the ledger disowns", () => {
  const alive = liveClaude();
  const sessions = new Map([
    ["real", { sessionId: "real", ...owner, timestamp: "2026-09-24T12:00:00.000Z" }],
    ["seed-session-1", { sessionId: "seed-session-1", ...owner, timestamp: "2026-09-24T12:00:00.000Z" }]
  ]);
  const removals = [];

  // Unreadable: nothing is removed on a probe that proves nothing.
  assert.equal(reapDeadSessions(new Map(sessions), alive, (event) => removals.push(event), undefined, null), 0);

  assert.equal(reapDeadSessions(sessions, alive, (event) => removals.push(event), undefined, new Set(["real"])), 1);
  assert.equal(sessions.has("seed-session-1"), false);
  assert.equal(sessions.has("real"), true);
  assert.equal(removals.at(-1).type, "unproven");
  assert.equal(removals.at(-1).removesSession, true);
});

/* Which terminal is which. The bridge names the familiar, reads the tty off
   the process table, and lends the session Claude Code's own name for it —
   and hands all three back to the terminal that asks. */
test("each session gets its own familiar, its terminal, and its name, and the terminal can ask for them", async (t) => {
  const second = { ownerPid: 4343, ownerStartedAt: "Thu Sep 24 10:00:02 2026" };
  const processes = () => [
    { pid: OWNER_PID, ppid: 1, tty: "ttys003", startedAt: OWNER_STARTED, command: "claude" },
    { pid: 4343, ppid: 1, tty: "ttys007", startedAt: second.ownerStartedAt, command: "claude" }
  ];
  let names = new Map([[OWNER_PID, { pid: OWNER_PID, sessionId: "one", name: "growth-report", nameSource: "user" }]]);
  /* Notes here carry no status on purpose: this test is about names and
     terminals, and a note without a status neither corrects nor discovers. */
  const server = createPatchServer({
    root, processSnapshot: processes, ledgerSnapshot: () => null, registrySnapshot: () => names, reapIntervalMs: 25
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/events`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });

  const expected = chooseFamiliar("one", []).type;
  const claimed = FAMILIARS.find((familiar) => familiar.type !== expected).type;
  const first = await post({ type: "session_started", sessionId: "one", agentName: "Claude", terminalProgram: "VS Code", familiarType: claimed, ...owner }).then((r) => r.json());
  assert.equal(first.event.familiarType, expected, "the bridge picks the familiar; a sender does not");
  assert.equal(first.event.terminalTty, "ttys003");
  assert.equal(first.event.sessionName, "growth-report");
  assert.equal(first.event.sessionNameSource, "user", "how the session got its name travels with it");
  const again = await post({ type: "stopped", sessionId: "one", ...owner }).then((r) => r.json());
  assert.equal(again.event.familiarType, first.event.familiarType, "a session keeps its face");

  const other = await post({ type: "session_started", sessionId: "two", ...second }).then((r) => r.json());
  assert.notEqual(other.event.familiarType, first.event.familiarType, "two live sessions never share a familiar");
  assert.equal(other.event.sessionName, undefined, "no note for this pid means no name");

  const lookup = await fetch(`${base}/api/sessions/one`).then((r) => r.json());
  assert.equal(lookup.familiar.type, first.event.familiarType);
  assert.equal(lookup.agentName, lookup.familiar.name, "a plain 'Claude' answers to its familiar's name");
  assert.equal(lookup.sessionName, "growth-report");
  assert.equal(lookup.sessionNameSource, "user");
  assert.equal(lookup.terminalTty, "ttys003");
  assert.equal(lookup.terminalProgram, "VS Code");
  assert.equal("ownerPid" in lookup, false);
  assert.equal((await fetch(`${base}/api/sessions/nobody`)).status, 404);
  assert.equal((await fetch(`${base}/api/sessions`).then((r) => r.json())).length, 2);

  // A rename in the terminal reaches the page within a sweep, as identity, not as a lifecycle event.
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events/stream`, { signal: controller.signal });
  const reader = response.body.getReader();
  names = new Map([[OWNER_PID, { pid: OWNER_PID, sessionId: "one", name: "growth-report-v2", nameSource: "derived" }]]);
  let output = "";
  for (let count = 0; count < 12 && !output.includes("growth-report-v2"); count += 1) {
    const chunk = await reader.read();
    output += new TextDecoder().decode(chunk.value || new Uint8Array());
  }
  controller.abort();
  assert.match(output, /event: patch-session\ndata: \{[^\n]*"sessionName":"growth-report-v2"/);
  const renamed = await fetch(`${base}/api/sessions/one`).then((r) => r.json());
  assert.equal(renamed.sessionName, "growth-report-v2");
  assert.equal(renamed.sessionNameSource, "derived", "a rename moves the source with the name");
});

/* "Is it connected?" answered where the map is. The bridge runs whatever
   install check it is handed and reports it in health, on the stream's first
   message and on every beat — and a bridge handed nothing reports nothing,
   rather than a guess. */
test("the bridge reports whether Claude Code is set up, in health and on every beat", async (t) => {
  const setup = { scope: "everywhere", file: "~/.claude/settings.json", hooks: { configured: 12, total: 12, missing: [] }, statusLine: { active: true } };
  let checks = 0;
  const server = patchServer({ heartbeatIntervalMs: 20, setupIntervalMs: 10_000, setupSnapshot: async () => { checks += 1; return setup; } });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${origin}/api/health`).then((response) => response.json());
  assert.deepEqual(health.setup, setup);

  const response = await fetch(`${origin}/api/events/stream`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (!seen.includes("patch-beat")) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  assert.match(seen, /event: ready\ndata: \{"ok":true,"setup":\{"scope":"everywhere"/, "the first message carries the check");
  assert.match(seen, /event: patch-beat\ndata: \{[^\n]*"setup":\{"scope":"everywhere"/, "so does every beat");
  assert.equal(checks, 1, "the check is a file read, cached between beats");

  const silent = patchServer();
  t.after(() => silent.close());
  silent.listen(0, "127.0.0.1");
  await once(silent, "listening");
  const unknown = await fetch(`http://127.0.0.1:${silent.address().port}/api/health`).then((r) => r.json());
  assert.equal(unknown.setup, null, "a bridge that is not checking says so");
});

test("a failing install check is reported as unknown, never as an error on the stream", async (t) => {
  const server = patchServer({ setupSnapshot: async () => { throw new Error("settings unreadable"); } });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const health = await fetch(`http://127.0.0.1:${server.address().port}/api/health`).then((r) => r.json());
  assert.equal(health.ok, true);
  assert.equal(health.setup, null);
});

test("session discovery is not counted as hook delivery; accepted hooks update diagnostics", async (t) => {
  const registry = new Map([[OWNER_PID, { pid: OWNER_PID, sessionId: "discovered", status: "idle", repository: "fixture" }]]);
  const server = patchServer({ registrySnapshot: () => registry, heartbeatIntervalMs: 20 });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const health = () => fetch(`${origin}/api/health`).then((r) => r.json());
  const before = await health();
  assert.equal(before.sessions, 1);
  assert.deepEqual(before.delivery, { hookEvents: 0, lastHookReceivedAt: null });
  const stream = await fetch(`${origin}/api/events/stream`, { signal: AbortSignal.timeout(2000) });
  const reader = stream.body.getReader();
  const response = await fetch(`${origin}/api/events`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...owner, sessionId: "discovered", type: "prompt_submitted" }) });
  assert.equal(response.status, 202);
  const after = await health();
  assert.equal(after.delivery.hookEvents, 1);
  assert.ok(Date.parse(after.delivery.lastHookReceivedAt));
  let seen = "";
  while (!seen.includes("event: patch-delivery") || !seen.includes("event: patch-beat")) {
    seen += new TextDecoder().decode((await reader.read()).value);
  }
  await reader.cancel();
  assert.match(seen, /event: patch-delivery\ndata: \{"hookEvents":1/);
  assert.match(seen, /event: patch-beat\ndata: [^\n]*"delivery":\{"hookEvents":1/);
  await fetch(`${origin}/api/events`, { method: "POST", body: JSON.stringify({ type: "needs_input", sessionId: "unproven" }) });
  assert.equal((await health()).delivery.hookEvents, 1, "refused events cannot prove hook delivery");
});

test("docs are served only by the source checkout's dev server", async (t) => {
  for (const [devFiles, expected] of [[false, 404], [true, 200]]) {
    const server = patchServer({ devFiles });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/docs/art-review.html`)).status, expected);
    assert.equal((await fetch(`${base}/docs/getting-started.md`)).status, 404, "markdown docs are never routes");
  }
});

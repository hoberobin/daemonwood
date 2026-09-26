import test from "node:test";
import assert from "node:assert/strict";
import { findSessionOwner, isSessionOwnerAlive, parseProcessTable } from "../src/process-liveness.js";

const processTable = `
  100     1 ttys003  Thu Sep 24 10:00:00 2026 /bin/zsh -il
  200   100 ??       Thu Sep 24 10:00:01 2026 /usr/local/bin/node some-unrelated-daemon.js
  300   100 ttys003  Thu Sep 24 11:00:00 2026 claude --dangerously-skip-permissions
  301   300 ttys003  Thu Sep 24 11:00:01 2026 /bin/sh -c node patch-hook.mjs
  302   301 ttys003  Thu Sep 24 11:00:01 2026 node patch-hook.mjs
`;

test("the process table carries each process's terminal, and none for daemons", () => {
  const processes = parseProcessTable(processTable);
  assert.equal(processes.find((entry) => entry.pid === 300).tty, "ttys003");
  assert.equal(processes.find((entry) => entry.pid === 200).tty, null, "?? is no terminal");
  // Linux spells the absent terminal differently and prefixes real ones with /dev/.
  const linux = parseProcessTable("  7   1 ?        Thu Sep 24 10:00:00 2026 daemon\n  8   7 /dev/pts/2 Thu Sep 24 10:00:00 2026 claude\n");
  assert.equal(linux[0].tty, null);
  assert.equal(linux[1].tty, "pts/2");
});

test("hook ancestry identifies the claude process that owns a session", () => {
  const processes = parseProcessTable(processTable);
  // The walk climbs past the intermediate shell to the long-lived CLI.
  assert.deepEqual(findSessionOwner({ startPid: 302, processes }), {
    ownerPid: 300,
    ownerStartedAt: "Thu Sep 24 11:00:00 2026"
  });
});

test("a hook with no claude ancestor claims no owner", () => {
  const processes = parseProcessTable(processTable);
  assert.equal(findSessionOwner({ startPid: 200, processes }), null);
  assert.equal(findSessionOwner({ startPid: 301, processes: null }), null);
});

test("owner liveness rejects missing and reused PIDs", () => {
  const processes = parseProcessTable(processTable);
  assert.equal(isSessionOwnerAlive({ ownerPid: 200, ownerStartedAt: "Thu Sep 24 10:00:01 2026" }, processes), true);
  assert.equal(isSessionOwnerAlive({ ownerPid: 200, ownerStartedAt: "Thu Sep 24 09:00:00 2026" }, processes), false);
  assert.equal(isSessionOwnerAlive({ ownerPid: 999, ownerStartedAt: "Thu Sep 24 10:00:01 2026" }, processes), false);
  assert.equal(isSessionOwnerAlive({}, processes), null);
});

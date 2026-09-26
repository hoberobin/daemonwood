import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createFamiliarLedger } from "../src/familiar-ledger.js";
import { chooseFamiliar, FAMILIARS } from "../src/familiars.js";
import { createPatchServer } from "../src/event-server.js";

const dir = () => mkdtempSync(join(tmpdir(), "patch-faces-"));

/* The familiar is the one word the terminal and the map share, so a session
   must keep its face for as long as it lives — through a bridge restart, and
   through whatever other sessions come and go around it. */
test("a session prefers one familiar for life and only steps aside while it is worn", () => {
  const own = chooseFamiliar("session-a", []);
  assert.equal(chooseFamiliar("session-a", [FAMILIARS.find((f) => f.type !== own.type).type]).type, own.type,
    "someone else wearing a different face changes nothing");
  const next = chooseFamiliar("session-a", [own.type]);
  assert.notEqual(next.type, own.type, "a worn face is not shared");
  assert.equal(chooseFamiliar("session-a", []).type, own.type, "and it is the same preference every time");
  // With every face taken, the preference still answers rather than throwing.
  assert.equal(chooseFamiliar("session-a", FAMILIARS.map((f) => f.type)).type, own.type);
});

test("the ledger remembers a face across runs, and forgets nothing it was not told", () => {
  const file = join(dir(), "familiars.json");
  const first = createFamiliarLedger({ file });
  assert.equal(first.recall("one"), null);
  first.remember("one", { familiarType: "moss", terminalProgram: "VS Code" });
  first.remember("two", { familiarType: "fern" });
  first.remember("", { familiarType: "fern" });
  first.remember("three", {});

  const second = createFamiliarLedger({ file });
  assert.deepEqual(second.recall("one").familiarType, "moss");
  assert.equal(second.recall("one").terminalProgram, "VS Code");
  assert.equal(second.recall("two").terminalProgram, null);
  assert.equal(second.size, 2, "a memory without a session or a face is not a memory");

  // The oldest memory goes first when the file is full.
  const small = createFamiliarLedger({ file: join(dir(), "small.json"), capacity: 2 });
  small.remember("a", { familiarType: "moss" });
  small.remember("b", { familiarType: "fern" });
  small.remember("c", { familiarType: "lumen" });
  assert.equal(small.recall("a"), null);
  assert.ok(small.recall("c"));

  // A file that is not JSON remembers nothing and breaks nothing.
  const broken = join(dir(), "broken.json");
  writeFileSync(broken, "{not json");
  const ledger = createFamiliarLedger({ file: broken });
  assert.equal(ledger.recall("one"), null);
  ledger.remember("one", { familiarType: "moss" });
  assert.equal(JSON.parse(readFileSync(broken, "utf8")).sessions.one.familiarType, "moss");
});

/* The live failure: the bridge restarted, the map came back from Claude Code's
   notes within two seconds, and the author's session — Moss all morning in
   the terminal's status line — was Nettle. */
test("a bridge restart does not change a session's face, unless someone live is wearing it", async (t) => {
  const OWNER = { ownerPid: 4242, ownerStartedAt: "Thu Sep 24 10:00:01 2026" };
  const OTHER = { ownerPid: 4343, ownerStartedAt: "Thu Sep 24 10:00:02 2026" };
  const processes = () => [
    { pid: 4242, ppid: 1, tty: "ttys003", startedAt: OWNER.ownerStartedAt, command: "claude" },
    { pid: 4343, ppid: 1, tty: "ttys007", startedAt: OTHER.ownerStartedAt, command: "claude" }
  ];
  const file = join(dir(), "familiars.json");
  const open = async (ledger) => {
    const server = createPatchServer({ root: process.cwd(), processSnapshot: processes, ledgerSnapshot: () => null, registrySnapshot: () => null, reapIntervalMs: 10_000, familiarLedger: ledger });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    return {
      post: (body) => fetch(`${base}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
      close: () => server.close()
    };
  };

  const first = await open(createFamiliarLedger({ file }));
  const worn = (await first.post({ type: "session_started", sessionId: "one", terminalProgram: "VS Code", ...OWNER })).event.familiarType;
  first.close();

  // Restarted, with a different session already on the map wearing a different face.
  const second = await open(createFamiliarLedger({ file }));
  // The bridge chooses faces, so the other session is steered onto a
  // different one by being admitted under an id whose preference differs.
  let otherId = "other";
  for (let n = 0; chooseFamiliar(otherId, []).type === worn; n += 1) otherId = `other-${n}`;
  await second.post({ type: "session_started", sessionId: otherId, ...OTHER });
  const back = (await second.post({ type: "session_started", sessionId: "one", ...OWNER })).event;
  assert.equal(back.familiarType, worn, "the same face as before the restart");
  assert.equal(back.terminalProgram, "VS Code", "and the terminal app the hook once reported");
  second.close();

  // Restarted again, and now a live session wears that exact face: it is not shared.
  const third = await open(createFamiliarLedger({ file }));
  let wearer = "wearer";
  for (let n = 0; chooseFamiliar(wearer, []).type !== worn; n += 1) wearer = `wearer-${n}`;
  await third.post({ type: "session_started", sessionId: wearer, ...OTHER });
  const taken = (await third.post({ type: "session_started", sessionId: "one", ...OWNER })).event;
  assert.notEqual(taken.familiarType, worn);

  // A bridge given no ledger still works, and simply chooses.
  const bare = await open(null);
  assert.ok((await bare.post({ type: "session_started", sessionId: "one", ...OWNER })).event.familiarType);
});

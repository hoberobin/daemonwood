import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isKnownSession, readSessionLedger } from "../src/session-proof.js";

function ledgerFixture() {
  const root = mkdtempSync(join(tmpdir(), "daemonwood-ledger-"));
  const project = join(root, "-Users-someone-work-app");
  mkdirSync(project);
  writeFileSync(join(project, "6ab1a288-4289-494c-a426-3274cd4d5401.jsonl"), "");
  mkdirSync(join(project, "6ab1a288-4289-494c-a426-3274cd4d5401")); // sidecar dir, not a session
  writeFileSync(join(project, "notes.md"), "not a transcript");
  const other = join(root, "-Users-someone-work-site");
  mkdirSync(other);
  writeFileSync(join(other, "411f6618-080c-4bb3-b5aa-9a2d102eb667.jsonl"), "");
  return root;
}

test("the ledger is every session Claude Code has opened, across every project", () => {
  const ids = readSessionLedger({ root: ledgerFixture() });
  assert.deepEqual([...ids].sort(), [
    "411f6618-080c-4bb3-b5aa-9a2d102eb667",
    "6ab1a288-4289-494c-a426-3274cd4d5401"
  ]);
  assert.equal(ids.has("notes"), false, "only transcripts name sessions");
  assert.equal(ids.has("seed-session-1"), false);
});

test("a ledger that cannot be read says so, rather than saying no", () => {
  assert.equal(readSessionLedger({ root: join(tmpdir(), "daemonwood-ledger-does-not-exist") }), null);
  assert.equal(isKnownSession("anything", null), null);
  assert.equal(isKnownSession("anything", undefined), null);
  assert.equal(isKnownSession("real", new Set(["real"])), true);
  assert.equal(isKnownSession("seed-session-1", new Set(["real"])), false);
});

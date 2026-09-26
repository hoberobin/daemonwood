import { claudeHome } from "./local-paths.js";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/* Where Claude Code keeps one transcript per session, named for that session's
   id: ~/.claude/projects/<project slug>/<session id>.jsonl */
export const SESSION_LEDGER_ROOT = join(claudeHome(), "projects");

/* The difference between a session and a story about one.

   A live process was never proof of a session. It is proof of a process, and a
   single `claude` you really are running will vouch for any number of sessions
   that were typed into a POST body — that is exactly how four invented
   familiars, one of them asking for permission nobody could grant, walked onto
   the map wearing the pids of four real ones.

   So the bridge asks Claude Code instead of asking the sender. Claude Code
   names each session's transcript after the session id, and nothing but Claude
   Code writes into that directory. The bridge never opens a transcript — it
   only asks whether the id is there. A sender can claim any id it likes; it
   cannot make Claude Code have opened it.

   `null` means the ledger could not be read, which proves nothing either way
   and must never cost anyone a familiar. */
export function readSessionLedger({ root = SESSION_LEDGER_ROOT } = {}) {
  let projects;
  try {
    projects = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }

  const ids = new Set();
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    let entries;
    try {
      entries = readdirSync(join(root, project.name));
    } catch {
      continue; // One unreadable project folder is not a verdict on the rest.
    }
    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) ids.add(entry.slice(0, -6));
    }
  }
  return ids;
}

/* Did Claude Code open this session? `null` is "cannot tell", and the caller
   must treat that as admission rather than refusal. */
export function isKnownSession(sessionId, ledger) {
  if (!(ledger instanceof Set)) return null;
  return ledger.has(String(sessionId));
}

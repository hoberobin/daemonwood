import { claudeHome } from "./local-paths.js";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/* Claude Code keeps a note about each running session next to its message
   socket: ~/.claude/sessions/<pid>.json. It is written the second the process
   starts — before any hook fires, and long before the first transcript line —
   and rewritten whenever something about the session changes. It names:

     pid, sessionId        which process hosts which session (the id changes
                           on /clear; the pid does not)
     startedAt             the process's own clock at start, epoch ms — what
                           lets the note be checked against `ps` so a note
                           left behind by a killed process can never speak
                           for whoever inherits its pid
     name, nameSource      what the session is called, and whether a person
                           set it with /rename
     status                Claude Code's own verdict: "waiting" while a
                           dialog is open, "busy" while it is working,
                           "idle" when the turn is yours
     waitingFor            what the dialog is, while status is "waiting"
     statusUpdatedAt       when status last changed, epoch ms
     cwd                   the project; only its last path segment leaves

   The bridge reads this as Claude Code's word on the session, and it is the
   strongest word there is: nothing but Claude Code writes here, and every
   note is tied to a live process. What a note says about a pid outranks what
   a sender posts about it. `null` means the directory could not be read,
   which proves nothing either way. */
export const SESSION_REGISTRY_ROOT = join(claudeHome(), "sessions");

const STATUSES = new Set(["waiting", "busy", "idle"]);

export function readSessionRegistry({ root = SESSION_REGISTRY_ROOT } = {}) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return null;
  }
  const byPid = new Map();
  for (const entry of entries) {
    const match = /^(\d+)\.json$/.exec(entry);
    if (!match) continue;
    try {
      const value = JSON.parse(readFileSync(join(root, entry), "utf8"));
      if (!value || typeof value !== "object") continue;
      const pid = Number(match[1]);
      byPid.set(pid, {
        pid,
        sessionId: value.sessionId ? String(value.sessionId) : null,
        name: cleanText(value.name, 60),
        nameSource: typeof value.nameSource === "string" ? value.nameSource : null,
        status: STATUSES.has(value.status) ? value.status : null,
        waitingFor: cleanText(value.waitingFor, 60),
        statusUpdatedAt: epoch(value.statusUpdatedAt),
        updatedAt: epoch(value.updatedAt),
        startedAt: epoch(value.startedAt),
        repository: typeof value.cwd === "string" ? basename(value.cwd) || null : null,
        /* Claude Code can hold a spare process warm before anyone types into
           it. It has a note; it is not a session. */
        spare: Boolean(value.spare)
      });
    } catch {
      continue; // One half-written note is not a verdict on the rest.
    }
  }
  return byPid;
}

/* The note for a pid, but only if it was written by the process that holds
   that pid now. A note has the process's start time; `ps` has it too. If they
   disagree by more than the slack a clock and a scheduler need, the note
   belongs to an earlier life of that pid and says nothing about this one.
   Either side missing means the check cannot be made, and the note is used
   as written: a note is Claude Code's own record, and the pid door has
   already demanded a live Claude process before anything reads it. */
export const START_SLACK_MS = 30_000;

export function noteForProcess(pid, processEntry, registry) {
  if (!(registry instanceof Map)) return null;
  const note = registry.get(Number(pid));
  if (!note || note.spare) return null;
  const psStart = Date.parse(processEntry?.startedAt || "");
  if (Number.isFinite(psStart) && Number.isFinite(note.startedAt) && Math.abs(psStart - note.startedAt) > START_SLACK_MS) {
    return null;
  }
  return note;
}

/* The note for this session, if the note and the session agree on both the
   pid and the session id. A pid alone is not enough: it is the same borrowed
   identity the process door already refuses. */
export function registryEntryFor(session, registry, processEntry) {
  if (!session?.ownerPid) return null;
  const entry = noteForProcess(session.ownerPid, processEntry, registry);
  if (!entry || !entry.sessionId || entry.sessionId !== String(session.sessionId)) return null;
  return entry;
}

export function sessionNameFor(session, registry, processEntry) {
  return registryEntryFor(session, registry, processEntry)?.name || null;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
  return text || null;
}

function epoch(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

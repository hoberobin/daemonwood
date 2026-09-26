import { patchHome } from "./local-paths.js";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/* Which face each session wore, remembered across bridge restarts.

   The familiar is the one word the two ends of the link share: the terminal's
   status line says "Moss", and the map shows the raccoon. The bridge chooses
   it at admission and used to keep it only in memory — so restarting the
   bridge, which the map otherwise survives without a trace (sessions come
   straight back from Claude Code's notes), handed every session a new face.
   The terminal said Moss all morning and the map said Nettle after lunch.
   Caught live on 2026-09-25, on the author's own session.

   This is a small file of session id → face, plus the terminal app the hook
   reported, which a session discovered from its note would otherwise lack
   until its next hook. Nothing else: it is a memory of the bridge's own
   choices, never a source of sessions. A missing or unreadable file means
   nothing is remembered, and the bridge chooses as it always did. */
export const FAMILIAR_LEDGER_FILE = join(patchHome(), "familiars.json");
const CAPACITY = 200;

export function createFamiliarLedger({ file = FAMILIAR_LEDGER_FILE, capacity = CAPACITY } = {}) {
  const faces = load(file);
  return {
    /* The face and terminal app this session had, if any. */
    recall(sessionId) {
      return faces.get(String(sessionId)) || null;
    },
    /* Remember a choice. A session keeps its place in the order it first
       appeared, so the oldest memory is the one dropped when the file is full. */
    remember(sessionId, { familiarType, terminalProgram } = {}) {
      if (!sessionId || !familiarType) return;
      const key = String(sessionId);
      const previous = faces.get(key);
      if (previous?.familiarType === familiarType && (previous.terminalProgram || null) === (terminalProgram || null)) return;
      faces.set(key, { familiarType, terminalProgram: terminalProgram || previous?.terminalProgram || null, at: Date.now() });
      while (faces.size > capacity) faces.delete(faces.keys().next().value);
      save(file, faces);
    },
    get size() {
      return faces.size;
    }
  };
}

function load(file) {
  const faces = new Map();
  if (!file) return faces;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    for (const [sessionId, entry] of Object.entries(value?.sessions || {})) {
      if (entry && typeof entry.familiarType === "string") {
        faces.set(sessionId, { familiarType: entry.familiarType, terminalProgram: typeof entry.terminalProgram === "string" ? entry.terminalProgram : null, at: Number(entry.at) || 0 });
      }
    }
  } catch {
    // Nothing remembered. The bridge chooses faces as it always did.
  }
  return faces;
}

/* Written whole, through a rename, so a bridge killed mid-write leaves the
   previous file rather than half of a new one. A failure to write is a
   failure to remember, and nothing worse. */
function save(file, faces) {
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ sessions: Object.fromEntries(faces) }, null, 2)}\n`, "utf8");
    renameSync(temporary, file);
  } catch {
    // Remembered in memory for this run at least.
  }
}

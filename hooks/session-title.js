import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/* The session's title — the words Claude Code puts on the terminal tab.

   Claude Code writes it into the session's transcript as a one-line entry:
   `{"type":"ai-title","aiTitle":"Character drawer titles",…}` a few seconds
   after the first prompt, or `{"type":"custom-title","customTitle":…}` when
   someone uses /rename. It re-appends both with the rest of its session
   metadata as the conversation grows, precisely so that anything reading the
   end of the file finds them — its own session list reads the tail too. So
   this reads only the last stretch of the file, and only lines that are one
   of those two entries. Nothing else in the transcript is parsed, kept or
   sent: the title is the one line of it that already sits in plain view on
   the tab.

   A /rename wins over the generated title, as it does on the tab. Anything
   unreadable is no title, never an error: a hook must not break a session. */
const TAIL_BYTES = 64 * 1024;
const MAX_LENGTH = 80;

export function readSessionTitle(transcriptPath, sessionId, { tailBytes = TAIL_BYTES } = {}) {
  if (typeof transcriptPath !== "string" || !transcriptPath.endsWith(".jsonl")) return null;
  let fd;
  try {
    fd = openSync(transcriptPath, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, tailBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return titleFromTail(buffer.toString("utf8"), sessionId);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* Already closed. */ }
  }
}

export function titleFromTail(text, sessionId) {
  let custom = null;
  let generated = null;
  for (const line of text.split("\n")) {
    if (!line.includes('"custom-title"') && !line.includes('"ai-title"')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (sessionId && entry?.sessionId && entry.sessionId !== sessionId) continue;
    if (entry?.type === "custom-title" && typeof entry.customTitle === "string") custom = entry.customTitle;
    if (entry?.type === "ai-title" && typeof entry.aiTitle === "string") generated = entry.aiTitle;
  }
  return cleanTitle(custom) || cleanTitle(generated);
}

function cleanTitle(value) {
  if (typeof value !== "string") return null;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
  return title || null;
}

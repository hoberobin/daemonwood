#!/usr/bin/env node
/* The map's answer to "which terminal is Moss?", printed where the question
   gets asked: in the terminal. Claude Code pipes its status-line facts here;
   this asks the bridge which familiar this session id is and writes the name
   in front of whatever status line was configured before. If the bridge is
   down, or does not know the session yet, the old status line prints alone.
   Nothing here may ever break a session, so every failure is a quiet one.

   The previous status line travels along as a base64 argument, so any command
   survives untouched — quoting and all — and `disconnect` can put it back
   exactly as it was. */
import { execFile } from "node:child_process";

import { localOrigin } from "../src/local-paths.js";
const origin = process.env.PATCH_ORIGIN || localOrigin();
const lookupTimeout = Number(process.env.PATCH_STATUSLINE_TIMEOUT_MS || 350);
const wrapped = decodeWrapped(process.argv.slice(2));

const input = await readStdin();
const [familiar, previous] = await Promise.all([lookupFamiliar(input), runWrapped(wrapped, input)]);

const lines = previous ? previous.replace(/\n$/, "").split("\n") : [];
const badge = familiar ? `\u001b[1m${familiar.name}\u001b[22m \u001b[2m${familiar.species}\u001b[22m` : "";
if (badge && lines.length) lines[0] = `${badge} \u001b[2m│\u001b[22m ${lines[0]}`;
else if (badge) lines.push(badge);
if (lines.length) process.stdout.write(`${lines.join("\n")}\n`);

async function lookupFamiliar(raw) {
  try {
    const sessionId = JSON.parse(raw)?.session_id;
    if (!sessionId) return null;
    const response = await fetch(`${origin}/api/sessions/${encodeURIComponent(sessionId)}`, {
      signal: AbortSignal.timeout(lookupTimeout)
    });
    if (!response.ok) return null;
    const session = await response.json();
    return session?.familiar?.name ? { name: session.agentName || session.familiar.name, species: session.familiar.species } : null;
  } catch {
    return null;
  }
}

function runWrapped(command, raw) {
  if (!command) return Promise.resolve("");
  return new Promise((resolve) => {
    const child = execFile("/bin/sh", ["-c", command], { timeout: 8_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve(typeof stdout === "string" ? stdout : "");
    });
    child.stdin.on("error", () => {});
    child.stdin.end(raw);
  });
}

export function decodeWrapped(args) {
  const index = args.indexOf("--then-b64");
  if (index === -1 || !args[index + 1]) return "";
  try {
    const previous = JSON.parse(Buffer.from(args[index + 1], "base64").toString("utf8"));
    return typeof previous?.command === "string" ? previous.command : "";
  } catch {
    return "";
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { value += chunk; });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", () => resolve(value));
  });
}

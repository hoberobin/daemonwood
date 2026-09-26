#!/usr/bin/env node
import { normalizeClaudeHook } from "./normalize-claude-event.js";
import { readSessionTitle } from "./session-title.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { installation, runtime, localOrigin, isPaused } from "../src/local-paths.js";
import { findSessionOwner } from "../src/process-liveness.js";

const endpoint = process.env.PATCH_ENDPOINT || `${localOrigin()}/api/events`;
const timeout = Number(process.env.PATCH_HOOK_TIMEOUT_MS || 750);

try {
  const input = JSON.parse(await readStdin());
  if (installation() && isPaused()) process.exit(0);
  /* The tab title, unless PATCH_SESSION_TITLES=0. Only the title line of
     the transcript is read, and nothing else from it leaves this process. */
  const title = process.env.PATCH_SESSION_TITLES === "0" ? null : readSessionTitle(input?.transcript_path, input?.session_id);
  const normalized = normalizeClaudeHook(input, { title, env: process.env });
  const event = normalized && { ...normalized, ...findSessionOwner() };
  if (!event) process.exit(0);
  try {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(runtime()?.token ? { Authorization: `Bearer ${runtime().token}` } : {}) },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(timeout)
  });
  if (response.status === 401) throw new Error("stale service");
  } catch {
    if (installation() && !isPaused() && !process.env.PATCH_ENDPOINT) {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/deliver.mjs', import.meta.url))], {
        detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: process.env
      });
      child.on('error', () => {});
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(event));
      child.unref();
    }
  }
} catch {
  // Fail open: The Patch must never block or break Claude Code.
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { value += chunk; if (value.length > 1024 * 1024) reject(new Error("input too large")); });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });
}

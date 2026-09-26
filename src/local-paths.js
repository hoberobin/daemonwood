import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";

export const patchHome = () => resolve(process.env.PATCH_HOME || join(homedir(), ".the-patch"));
export const claudeHome = () => resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
export function readLocalJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}
export const installation = () => readLocalJson(join(patchHome(), "install.json"));
export const runtime = () => readLocalJson(join(patchHome(), "runtime.json"));
export const isPaused = () => readLocalJson(join(patchHome(), "paused.json"), false) === true;
export function localOrigin() {
  const value = runtime()?.origin;
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(value || "") ? value : "http://127.0.0.1:4173";
}

import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";

/* Settings read DAEMONWOOD_<NAME>, then the PATCH_<NAME> it was called before
   the rename, so an override set under the old name keeps working. */
export const setting = name => process.env[`DAEMONWOOD_${name}`] ?? process.env[`PATCH_${name}`];
export const daemonwoodHome = () => resolve(setting("HOME") || join(homedir(), ".daemonwood"));
export const claudeHome = () => resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
export function readLocalJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}
export const installation = () => readLocalJson(join(daemonwoodHome(), "install.json"));
export const runtime = () => readLocalJson(join(daemonwoodHome(), "runtime.json"));
export const isPaused = () => readLocalJson(join(daemonwoodHome(), "paused.json"), false) === true;
export function localOrigin() {
  const value = runtime()?.origin;
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(value || "") ? value : "http://127.0.0.1:4173";
}

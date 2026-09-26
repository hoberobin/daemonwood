import { mkdir, writeFile, rename, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export async function atomicJson(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, file);
  } finally { await rm(temp, { force: true }); }
}

// Locks coordinate our processes. Dead owners are recoverable; a live owner is
// never evicted just because an install is taking a while.
export async function withLock(path, action, timeout = 12000) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeout;
  const id = randomUUID();
  while (true) {
    try {
      await mkdir(path, { mode: 0o700 });
      await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, id }), { mode: 0o600 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let dead = false;
      try {
        const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
        try { process.kill(owner.pid, 0); } catch (e) { dead = e.code === "ESRCH"; }
      } catch {
        try { dead = Date.now() - (await stat(path)).mtimeMs > 30000; } catch {}
      }
      if (dead) {
        // Rename the stale lock before removing it, never remove a replacement.
        const stale = `${path}.stale-${id}`;
        try { await rename(path, stale); await rm(stale, { recursive: true, force: true }); } catch {}
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Another Daemonwood operation is still running. Try again in a moment.");
      await delay(60);
    }
  }
  try { return await action(); }
  finally {
    try {
      const owner = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
      if (owner.id === id) await rm(path, { recursive: true, force: true });
    } catch {}
  }
}

// Refuse malformed settings and preserve concurrent edits by retrying the
// merge against fresh bytes. No whole-file backup is restored over user edits.
export async function editSettings(file, transform) {
  return withLock(`${file}.daemonwood-lock`, async () => {
    const read = async () => { try { return await readFile(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return "{}"; throw e; } };
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await read();
      let settings;
      try { settings = JSON.parse(before); } catch { throw new Error(`Cannot update ${file}: it contains invalid JSON.`); }
      if (!settings || Array.isArray(settings) || typeof settings !== "object") throw new Error(`Cannot update ${file}: settings must be an object.`);
      const next = transform(settings);
      if (JSON.stringify(next) === JSON.stringify(settings)) return next;
      if (await read() !== before) continue;
      await atomicJson(file, next);
      return next;
    }
    throw new Error("Claude settings changed during setup. Run Daemonwood again.");
  });
}

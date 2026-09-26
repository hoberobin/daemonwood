import { readdir } from "node:fs/promises";
import { join } from "node:path";

// The same payload is used by npm and the durable installer. Editable source
// artwork and reference documents stay in the development checkout.
export const payload = ["bin", "hooks", "src", "server.mjs", "index.html", "package.json",
  "scripts/cli.mjs", "scripts/runtime.mjs", "scripts/local-files.mjs", "scripts/package-files.mjs",
  "scripts/daemon.mjs", "scripts/deliver.mjs", "scripts/claude-setup.mjs",
  "assets/map", "assets/sprites", "assets/palette"];

export async function payloadFiles(root) {
  const files = [];
  async function walk(relative) {
    const { lstat } = await import("node:fs/promises");
    const info = await lstat(join(root, relative));
    if (info.isSymbolicLink()) throw new Error(`Runtime payload cannot contain a symlink: ${relative}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(join(root, relative))).sort()) await walk(`${relative}/${name}`);
    } else files.push(relative);
  }
  for (const path of payload) await walk(path);
  return files;
}

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { createDaemonwoodServer } from "./src/event-server.js";
import { createFamiliarLedger } from "./src/familiar-ledger.js";
import { claudeHome, installation, daemonwoodHome, setting, displayCommand } from "./src/local-paths.js";
import { CLAUDE_EVENTS, inspectDaemonwoodHooks, inspectDaemonwoodStatusLine } from "./scripts/claude-setup.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export async function setupSnapshot() {
  const installed = installation();
  const file = join(claudeHome(), "settings.json");
  // The installed command works however Daemonwood was first launched (npx,
  // global, checkout); the dev server has none and names its own files.
  const command = installed ? displayCommand() : `${quote(process.execPath)} ${quote(join(root, 'bin/daemonwood.mjs'))}`;
  const repairCommand = `${command} repair`;
  const statusCommand = `${command} status`;
  try {
    let settings = {};
    try { settings = JSON.parse(await readFile(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
    const hooks = inspectDaemonwoodHooks(settings);
    const status = inspectDaemonwoodStatusLine(settings);
    return { scope: "profile", hooks: { configured: hooks.configured.length, total: CLAUDE_EVENTS.length, missing: hooks.missing },
      statusLine: status, blocked: Boolean(settings.disableAllHooks), repairCommand, statusCommand };
  } catch { return { error: "Claude settings could not be read.", repairCommand, statusCommand }; }
}

export function makeServer(options = {}) {
  return createDaemonwoodServer({ root, setupSnapshot, familiarLedger: createFamiliarLedger(), ...options });
}

export async function listen(server, port = 4173) {
  await new Promise((resolve, reject) => {
    const fail = error => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', fail); resolve(); };
    server.once('error', fail); server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
  return `http://127.0.0.1:${server.address().port}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = makeServer({ devFiles: true });
  try { console.log(`Daemonwood preview: ${await listen(server, Number(setting("PORT") || 4173))}`); }
  catch (error) { console.error(`Daemonwood: ${error.message}`); process.exit(1); }
}

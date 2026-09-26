import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { makeServer, listen } from '../server.mjs';
import { daemonwoodHome, installation, runtime, setting } from '../src/local-paths.js';
import { atomicJson } from './local-files.mjs';

const installed = installation();
if (!installed) process.exit(1);
const instance = randomUUID();
const token = randomUUID();
const identity = { instance, build: installed.build, version: installed.version };
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  if (runtime()?.instance === instance) await rm(join(daemonwoodHome(), 'runtime.json'), { force: true });
  server.close();
  server.closeAllConnections();
  // SSE connections are long-lived; exiting closes those too.
  setTimeout(() => process.exit(0), 50);
};
const server = makeServer({ identity, token, onShutdown: shutdown });
try {
  let origin;
  const preferred = Number(setting("PORT") || 4173);
  try { origin = await listen(server, preferred); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; origin = await listen(server, 0); }
  await atomicJson(join(daemonwoodHome(), 'runtime.json'), { ...identity, token, origin, pid: process.pid, startedAt: new Date().toISOString() });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) { console.error(`Unable to start: ${error.message}`); process.exit(1); }

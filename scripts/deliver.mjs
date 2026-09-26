// Receives only an already sanitized event, never raw Claude input. Used for
// cold-start recovery so a hook never waits for the background server to boot.
import { ensureRunning } from './runtime.mjs';
import { runtime, isPaused } from '../src/local-paths.js';
const timer = setTimeout(() => process.exit(0), 10000);
try {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 65536) process.exit(0); }
  if (!isPaused()) {
    const service = await ensureRunning();
    if (service) await fetch(`${service.origin}/api/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runtime()?.token}` },
      body: input, signal: AbortSignal.timeout(1000)
    });
  }
} catch {} finally { clearTimeout(timer); }

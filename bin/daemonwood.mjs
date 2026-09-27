#!/usr/bin/env node
// Checked before anything else loads, so an old Node gets a sentence, not a stack trace.
if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error(`Daemonwood needs Node.js 22 or newer; this is ${process.version}. Install Node.js 24 LTS from https://nodejs.org, then run it again.`);
  process.exit(1);
}
const { main } = await import("../scripts/cli.mjs");
try { await main(); }
catch (error) { console.error(`Daemonwood: ${error.message}`); process.exitCode = 1; }

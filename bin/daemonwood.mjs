#!/usr/bin/env node
import { main } from "../scripts/cli.mjs";
try { await main(); }
catch (error) { console.error(`Daemonwood: ${error.message}`); process.exitCode = 1; }

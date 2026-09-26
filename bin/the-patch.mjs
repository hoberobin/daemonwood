#!/usr/bin/env node
import { main } from "../scripts/cli.mjs";
try { await main(); }
catch (error) { console.error(`The Patch: ${error.message}`); process.exitCode = 1; }

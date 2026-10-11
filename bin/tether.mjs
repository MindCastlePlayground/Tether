#!/usr/bin/env node
import { Cli } from '../installer/cli.mjs';

try { process.exitCode = await Cli.main(process.argv.slice(2)); }
catch (error) { console.error(`Tether: ${error.message}`); process.exitCode = 1; }

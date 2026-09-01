#!/usr/bin/env node
import { existsSync } from 'node:fs';

import { main, reportError } from '../src/cli.js';

loadDotEnv();

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}

/**
 * Load a local .env without adding a dependency.
 *
 * process.loadEnvFile landed in Node 20.12; on anything older a .env sitting
 * right there would be ignored silently, which reads as a bad token rather than
 * an old runtime. Say so instead.
 */
function loadDotEnv() {
  if (!existsSync('.env')) return;
  if (typeof process.loadEnvFile !== 'function') {
    process.stderr.write(
      `Found .env but this Node (${process.version}) cannot read it; Node 20.12 or newer is required.\n` +
      'Either upgrade Node, or export GHL_API_TOKEN and GHL_LOCATION_ID in the environment.\n',
    );
    return;
  }
  process.loadEnvFile('.env');
}

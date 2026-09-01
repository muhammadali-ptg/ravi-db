#!/usr/bin/env node
import { main, reportError } from '../src/cli.js';

// Load a local .env if present, without adding a dependency.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file - rely on the ambient environment.
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}

#!/usr/bin/env node

// Compatibility command retained for existing local invocations. The active
// readiness contract is provider-neutral and Cloudflare-only.
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, [
  'scripts/verify-api-less-generation-readiness.mjs',
  ...process.argv.slice(2),
], { stdio: 'inherit' });
process.exit(result.status ?? 1);

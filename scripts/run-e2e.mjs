#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const bin = join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');

if (!existsSync(bin)) {
  console.log('Playwright is declared as a devDependency but is not installed in this environment.');
  console.error('E2E was not executed. Run npm install when registry access is available, then rerun npm run e2e.');
  process.exit(1);
}

const result = spawnSync(bin, ['test'], { stdio: 'inherit' });
process.exit(result.status ?? 1);

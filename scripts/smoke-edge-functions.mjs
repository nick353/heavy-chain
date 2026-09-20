#!/usr/bin/env node

/**
 * Retained only as a compatibility entrypoint for older release checklists.
 * The retired Edge Function smoke test must not read or execute the historical
 * retired provider tree. The Cloudflare runtime contract is the sole active check.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
export async function main() {
  await import('./verify-cloudflare-runtime-contract.mjs');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}

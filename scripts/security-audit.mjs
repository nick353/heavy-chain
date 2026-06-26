#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'output']);
const includeLocalEnv = process.env.SECURITY_AUDIT_INCLUDE_LOCAL_ENV === '1';
const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
      continue;
    }
    if (!shouldScanFile(entry)) continue;
    const rel = full.slice(root.length + 1);
    if (!includeLocalEnv && isLocalSecretEnvFile(rel)) continue;
    scan(full);
  }
}

function shouldScanFile(entry) {
  if (entry === '.env' || entry.startsWith('.env.')) return true;
  return /\.(ts|tsx|js|jsx|mjs|sql|md|env|example|sh|json)$/.test(entry);
}

function isLocalSecretEnvFile(rel) {
  const normalized = rel.replaceAll('\\', '/');
  return normalized === '.env'
    || normalized.endsWith('/.env')
    || normalized.endsWith('.local');
}

function scan(file) {
  const rel = file.slice(root.length + 1);
  const text = readFileSync(file, 'utf8');
  const checks = [
    [/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]?(?:eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40,})/i, 'possible Supabase service role key assignment'],
    [/service_role[_-]?[a-z0-9]{20,}/i, 'possible hard-coded service role token'],
    [/(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/, 'possible OpenAI API key'],
    [/AIza[0-9A-Za-z_-]{20,}/, 'possible Google API key'],
    [/image_url:\s*storageUrl\s*\|\|\s*imageDataUrl/, 'DB image_url stores signed/data URL fallback'],
    [/image_url:\s*imageDataUrl/, 'DB image_url stores data URL'],
  ];

  for (const [pattern, message] of checks) {
    if (pattern.test(text)) {
      findings.push(`${rel}: ${message}`);
    }
  }
}

walk(root);

if (findings.length > 0) {
  console.error('Security audit failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Security audit passed. No secret values were printed.');

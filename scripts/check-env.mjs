#!/usr/bin/env node

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GEMINI_API_KEY',
  'PUBLIC_URL',
];

const optional = [
  'SUPABASE_PROJECT_REF',
  'SUPABASE_ACCESS_TOKEN',
  'RUNWAY_MCP_BRIDGE_URL',
  'RUNWAY_MCP_BRIDGE_TOKEN',
  'RUNWAY_MCP_TOKEN_ENCRYPTION_KEY',
];

const missing = required.filter((key) => !process.env[key]);
const presentOptional = optional.filter((key) => Boolean(process.env[key]));

console.log(`Environment check: ${required.length - missing.length}/${required.length} required keys present.`);
console.log(`Optional deployment keys present: ${presentOptional.length}/${optional.length}.`);

if (missing.length > 0) {
  console.error(`Missing required keys: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Environment check passed. Secret values were not printed.');

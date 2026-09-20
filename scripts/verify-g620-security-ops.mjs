#!/usr/bin/env node

import fs from 'node:fs';

const sourceRoots = ['src', 'cloudflare/heavy-api/src', 'cloudflare/heavy-web/src'];
const required = [
  'src/lib/cloudflareApi.ts',
  'src/lib/cloudflareBrowserAuth.ts',
  'src/lib/mediaGateway.ts',
  'cloudflare/heavy-api/src/index.ts',
];
const forbidden = [
  /@supabase\//i,
  /\.supabase\.co/i,
  /\/auth\/v1\//i,
  /\/rest\/v1\//i,
  /\/functions\/v1\//i,
  /SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)/i,
];
const walk = (root) => {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = `${root}/${entry.name}`;
    if (entry.isDirectory()) return walk(file);
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [file] : [];
  });
};
const files = sourceRoots.flatMap(walk);
const legacy = files.flatMap((file) => {
  const text = fs.readFileSync(file, 'utf8');
  return forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${file}:${pattern}`);
});
const checks = [
  ['cloudflare_entrypoints_exist', required.every((file) => fs.existsSync(file))],
  ['legacy_runtime_markers_absent', legacy.length === 0],
  ['private_media_route_present', files.some((file) => fs.readFileSync(file, 'utf8').includes('/v1/media'))],
  ['provider_action_route_present', files.some((file) => fs.readFileSync(file, 'utf8').includes('provider-actions'))],
  ['runtime_auth_boundary_present', files.some((file) => fs.readFileSync(file, 'utf8').includes('consumer-auth'))],
];
const report = {
  schema: 'heavy-chain.g620.security-ops.v3',
  capturedAt: new Date().toISOString(),
  mode: 'read-only-static-cloudflare-no-submit-no-payment-no-deploy',
  irreversibleActions: { generationSubmit: 'not_clicked', purchasePaymentCheckout: 'not_touched', deploy: 'not_run' },
  checks: checks.map(([id, passed]) => ({ id, passed })),
  failures: legacy,
  ok: checks.every(([, passed]) => passed),
  proofLimits: ['This gate does not prove production traffic-zero, provider quality, or authenticated browser completion.'],
};
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);

#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const publicOrigin = 'https://heavy-chain-web.nichika2000823.workers.dev';
const outPath = process.argv[2] || 'output/playwright/g835-chosen-public-entrypoint-readback-r1/summary.json';
const capturedAt = new Date().toISOString();

async function read(url) {
  const response = await fetch(url, { redirect: 'manual' });
  const body = await response.text();
  return {
    status: response.status,
    redirect: response.headers.get('location'),
    contentType: response.headers.get('content-type'),
    bodyLength: body.length,
    bodyPrefix: body.slice(0, 500),
    assetReference: (body.match(/assets\/[A-Za-z0-9._-]+\.(?:js|css)/)?.[0]) ?? null,
    hasHeavyChainShell: /Heavy Chain|LIGHTCHAIN|AI駆動のアパレル/i.test(body),
  };
}

const root = await read(`${publicOrigin}/`);
const authSession = await read(`${publicOrigin}/api/auth/get-session`);
const report = {
  schema: 'heavy-chain.chosen-public-entrypoint-readback.v2',
  capturedAt,
  mode: 'read-only-http-shell-and-auth-boundary',
  ok: root.status >= 200 && root.status < 300 && root.hasHeavyChainShell && authSession.status >= 200 && authSession.status < 300,
  urls: { chosenPublicEntrypoint: publicOrigin },
  findings: {
    chosenPublicEntrypoint: {
      reachable: root.status >= 200 && root.status < 300,
      status: root.status,
      hasHeavyChainShell: root.hasHeavyChainShell,
      contentType: root.contentType,
      bodyLength: root.bodyLength,
      redirect: root.redirect,
      assetReference: root.assetReference,
    },
    publicAuthBoundary: {
      sessionEndpoint: `${publicOrigin}/api/auth/get-session`,
      status: authSession.status,
      unauthenticatedSessionBody: authSession.bodyPrefix === 'null',
      bodyLength: authSession.bodyLength,
      contentType: authSession.contentType,
    },
  },
  safetyBoundaries: {
    generationSubmit: 'not_clicked',
    billingCheckoutPayment: 'not_touched',
    externalPublish: 'not_touched',
    deployment: 'not_run',
  },
  externalEffect: 'read-only public HTTP readback; no provider, generation, upload, save, auth, billing, payment, or publish action',
  proofLimit: 'This proves public HTTP reachability and the unauthenticated boundary only; it is not authenticated production UI or provider completion proof.',
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: report.ok, outPath, capturedAt, rootStatus: root.status, authSessionStatus: authSession.status }, null, 2));
process.exit(report.ok ? 0 : 1);

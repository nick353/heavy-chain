#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  PINNED_EXTERNAL_CLOTH_MODEL_BYTES,
  PINNED_EXTERNAL_CLOTH_MODEL_REVISION,
  PINNED_EXTERNAL_CLOTH_MODEL_SHA256,
  PINNED_EXTERNAL_CLOTH_MODEL_URL,
} from './rembg-cloth-model-build-contract.mjs';

const DEFAULT_PROOF_PATH = 'output/rembg-cloth-model-external-host-build.json';
const DEFAULT_BROWSER_ORIGIN = 'https://heavy-chain.zeabur.app';
const STALE_SAME_ORIGIN_MODEL_PATH = 'public/models/u2net_cloth_seg.onnx';
const MAX_REDIRECTS = 3;

const allowedHost = (hostname, initial) => initial
  ? hostname === 'huggingface.co'
  : hostname === 'huggingface.co' || hostname.endsWith('.cdn.hf.co');

const cleanDigest = (value) => String(value || '').trim().replace(/^W\//, '').replace(/^"|"$/g, '').toLowerCase();

const writeProof = async (proofPath, value) => {
  await fs.mkdir(path.dirname(proofPath), { recursive: true });
  await fs.writeFile(proofPath, `${JSON.stringify(value, null, 2)}\n`);
};

const rejectStaleSameOriginModel = async (cwd, stage) => {
  const stalePath = path.join(cwd, STALE_SAME_ORIGIN_MODEL_PATH);
  try {
    const stat = await fs.lstat(stalePath);
    throw new Error(`cloth_model_external_build_stale_same_origin_asset:${stage}:${stat.size}`);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
};

const runCommand = (command, args, { env, cwd }) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cloth_model_external_build_command_failed:${command}:${args.join(' ')}:${result.status}`);
  }
};

export const verifyPinnedExternalClothModelHead = async ({
  url = PINNED_EXTERNAL_CLOTH_MODEL_URL,
  browserOrigin = DEFAULT_BROWSER_ORIGIN,
  fetchImpl = fetch,
} = {}) => {
  if (url !== PINNED_EXTERNAL_CLOTH_MODEL_URL || !url.includes(`/${PINNED_EXTERNAL_CLOTH_MODEL_REVISION}/`)) {
    throw new Error('cloth_model_external_url_not_revision_pinned');
  }

  let currentUrl = url;
  let linkedBytes = null;
  let linkedSha256 = null;
  const redirects = [];
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !allowedHost(parsed.hostname, attempt === 0)) {
      throw new Error(`cloth_model_external_host_not_allowed:${parsed.hostname}`);
    }
    const response = await fetchImpl(parsed, {
      method: 'HEAD',
      redirect: 'manual',
      headers: { Origin: browserOrigin },
    });
    linkedBytes ??= Number.parseInt(response.headers.get('x-linked-size') || '', 10) || null;
    linkedSha256 ??= cleanDigest(response.headers.get('x-linked-etag')) || null;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || attempt === MAX_REDIRECTS) throw new Error('cloth_model_external_redirect_invalid');
      const nextUrl = new URL(location, parsed);
      if (nextUrl.protocol !== 'https:' || !allowedHost(nextUrl.hostname, false)) {
        throw new Error(`cloth_model_external_redirect_host_not_allowed:${nextUrl.hostname}`);
      }
      redirects.push({ status: response.status, host: nextUrl.hostname });
      currentUrl = nextUrl.href;
      continue;
    }

    if (response.status !== 200) throw new Error(`cloth_model_external_http_status:${response.status}`);
    if (response.headers.get('access-control-allow-origin') !== '*') {
      throw new Error(`cloth_model_external_cors_mismatch:${response.headers.get('access-control-allow-origin') || 'missing'}`);
    }
    const finalBytes = Number.parseInt(response.headers.get('content-length') || '', 10);
    if (finalBytes !== PINNED_EXTERNAL_CLOTH_MODEL_BYTES || linkedBytes !== PINNED_EXTERNAL_CLOTH_MODEL_BYTES) {
      throw new Error(`cloth_model_external_size_mismatch:${finalBytes}:${linkedBytes}`);
    }
    if (linkedSha256 !== PINNED_EXTERNAL_CLOTH_MODEL_SHA256) {
      throw new Error(`cloth_model_external_sha256_header_mismatch:${linkedSha256 || 'missing'}`);
    }
    return {
      url,
      finalHost: parsed.hostname,
      redirects,
      cors: '*',
      bytes: finalBytes,
      sha256: linkedSha256,
      verification: 'HEAD x-linked-size/x-linked-etag plus final CDN content-length/CORS',
    };
  }
  throw new Error('cloth_model_external_redirect_limit_exceeded');
};

export const buildPinnedExternalClothModel = async ({
  cwd = process.cwd(),
  proofPath = path.join(cwd, DEFAULT_PROOF_PATH),
  fetchImpl = fetch,
  commandRunner = runCommand,
} = {}) => {
  const startedAt = new Date().toISOString();
  try {
    await rejectStaleSameOriginModel(cwd, 'before_build');
    const remote = await verifyPinnedExternalClothModelHead({ fetchImpl });
    const env = { ...process.env, VITE_REMBG_CLOTH_SEG_MODEL_URL: PINNED_EXTERNAL_CLOTH_MODEL_URL };
    commandRunner(process.execPath, ['scripts/verify-rembg-model-deploy-readiness.mjs', '--require-cloth'], { env, cwd });
    commandRunner('npm', ['run', 'build'], { env, cwd });
    await rejectStaleSameOriginModel(cwd, 'after_build');
    commandRunner(process.execPath, [
      'scripts/verify-rembg-model-deploy-readiness.mjs',
      '--require-cloth',
      '--verify-dist',
    ], { env, cwd });
    const result = {
      schema: 'heavy-chain-rembg-cloth-model-external-host-build.v1',
      ok: true,
      status: 'built',
      startedAt,
      checkedAt: new Date().toISOString(),
      browserModelUrl: PINNED_EXTERNAL_CLOTH_MODEL_URL,
      remote,
      claims: {
        proves: [
          'revision-pinned URL',
          'remote HEAD identity headers',
          'final CDN CORS',
          'URL embedded in dist',
          'no stale same-origin cloth model before or after build',
        ],
        doesNotProve: ['production deploy', 'full model download during build', 'browser inference'],
      },
    };
    await writeProof(proofPath, result);
    return result;
  } catch (error) {
    await writeProof(proofPath, {
      schema: 'heavy-chain-rembg-cloth-model-external-host-build.v1',
      ok: false,
      status: 'failed',
      startedAt,
      checkedAt: new Date().toISOString(),
      browserModelUrl: PINNED_EXTERNAL_CLOTH_MODEL_URL,
      exactBlocker: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  buildPinnedExternalClothModel().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(JSON.stringify({ ok: false, exactBlocker: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}

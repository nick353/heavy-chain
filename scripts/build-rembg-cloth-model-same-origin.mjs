#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { OFFICIAL_CLOTH_MODEL } from './verify-rembg-cloth-model-compatibility.mjs';
import {
  OFFICIAL_CLOTH_MODEL_SOURCE_URL,
  SAME_ORIGIN_CLOTH_MODEL_URL,
} from './rembg-cloth-model-build-contract.mjs';

export { OFFICIAL_CLOTH_MODEL_SOURCE_URL, SAME_ORIGIN_CLOTH_MODEL_URL };

const DEFAULT_STAGED_MODEL_PATH = 'public/models/u2net_cloth_seg.onnx';
const DEFAULT_STAGE_PROOF_PATH = 'output/rembg-cloth-model-same-origin-stage.json';
const DEFAULT_BUILD_PROOF_PATH = 'output/rembg-cloth-model-same-origin-build.json';
const ALLOWED_DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com']);

const parseArguments = (argv) => Object.fromEntries(argv.slice(2).map((argument) => {
  const separator = argument.indexOf('=');
  return separator === -1
    ? [argument.replace(/^--/, ''), true]
    : [argument.slice(0, separator).replace(/^--/, ''), argument.slice(separator + 1)];
}));

const createIdentityTransform = (expectedModel) => {
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  return {
    stream: new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > expectedModel.bytes) {
          callback(new Error(`cloth_model_size_mismatch:${bytes}:expected:${expectedModel.bytes}`));
          return;
        }
        digest.update(chunk);
        callback(null, chunk);
      },
    }),
    identity: () => ({ bytes, sha256: digest.digest('hex') }),
  };
};

export const readFileIdentity = async (filePath) => {
  const digest = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  return { bytes, sha256: digest.digest('hex') };
};

const identityMatches = (identity, expectedModel) => (
  identity.bytes === expectedModel.bytes && identity.sha256 === expectedModel.sha256
);

const openOfficialDownload = async ({ sourceUrl, fetchImpl = fetch }) => {
  const parsedSource = new URL(sourceUrl);
  if (parsedSource.protocol !== 'https:' || parsedSource.username || parsedSource.password) {
    throw new Error('cloth_model_source_url_invalid');
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsedSource.hostname)) {
    throw new Error(`cloth_model_source_host_not_allowed:${parsedSource.hostname}`);
  }
  const response = await fetchImpl(parsedSource, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`cloth_model_source_http_status:${response.status}`);
  }
  const finalUrl = new URL(response.url || sourceUrl);
  if (finalUrl.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(finalUrl.hostname)) {
    throw new Error(`cloth_model_source_redirect_host_not_allowed:${finalUrl.hostname}`);
  }
  return {
    stream: Readable.fromWeb(response.body),
    sourceKind: 'official_download',
    sourceHost: finalUrl.hostname,
  };
};

const writeProof = async (proofPath, value) => {
  await fsp.mkdir(path.dirname(proofPath), { recursive: true });
  await fsp.writeFile(proofPath, `${JSON.stringify(value, null, 2)}\n`);
};

export const stageClothModel = async ({
  sourceFile = '',
  destinationPath = DEFAULT_STAGED_MODEL_PATH,
  proofPath = DEFAULT_STAGE_PROOF_PATH,
  expectedModel = OFFICIAL_CLOTH_MODEL,
  sourceUrl = OFFICIAL_CLOTH_MODEL_SOURCE_URL,
  fetchImpl = fetch,
} = {}) => {
  await fsp.mkdir(path.dirname(destinationPath), { recursive: true });
  await writeProof(proofPath, {
    schema: 'heavy-chain-rembg-cloth-model-same-origin-stage.v1',
    ok: false,
    status: 'running',
    startedAt: new Date().toISOString(),
    destinationPath,
  });
  if (fs.existsSync(destinationPath)) {
    const currentIdentity = await readFileIdentity(destinationPath);
    if (identityMatches(currentIdentity, expectedModel)) {
      const result = {
        schema: 'heavy-chain-rembg-cloth-model-same-origin-stage.v1',
        ok: true,
        status: 'reused',
        checkedAt: new Date().toISOString(),
        destinationPath,
        sourceKind: 'existing_pinned_asset',
        model: currentIdentity,
      };
      await writeProof(proofPath, result);
      return result;
    }
  }

  const temporaryPath = `${destinationPath}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    const source = sourceFile
      ? {
          stream: fs.createReadStream(sourceFile),
          sourceKind: 'local_build_input',
          sourceHost: null,
        }
      : await openOfficialDownload({ sourceUrl, fetchImpl });
    const identity = createIdentityTransform(expectedModel);
    await pipeline(
      source.stream,
      identity.stream,
      fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
    );
    const stagedIdentity = identity.identity();
    if (!identityMatches(stagedIdentity, expectedModel)) {
      throw new Error(
        `cloth_model_identity_mismatch:${stagedIdentity.bytes}:${stagedIdentity.sha256}`,
      );
    }
    await fsp.chmod(temporaryPath, 0o644);
    await fsp.rename(temporaryPath, destinationPath);
    const result = {
      schema: 'heavy-chain-rembg-cloth-model-same-origin-stage.v1',
      ok: true,
      status: 'staged',
      checkedAt: new Date().toISOString(),
      destinationPath,
      sourceKind: source.sourceKind,
      sourceHost: source.sourceHost,
      model: stagedIdentity,
      claims: {
        proves: ['staged model bytes', 'staged model SHA-256', 'atomic destination replacement'],
        doesNotProve: ['production deploy', 'browser inference', 'semantic quality acceptance'],
      },
    };
    await writeProof(proofPath, result);
    return result;
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true });
    const failure = {
      schema: 'heavy-chain-rembg-cloth-model-same-origin-stage.v1',
      ok: false,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      destinationPath,
      exactBlocker: error instanceof Error ? error.message : String(error),
    };
    await writeProof(proofPath, failure);
    throw error;
  }
};

const runCommand = (command, args, { env, cwd }) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`cloth_model_build_command_failed:${command}:${args.join(' ')}:${result.status}`);
  }
};

export const buildSameOriginClothModel = async ({
  cwd = process.cwd(),
  sourceFile = process.env.REMBG_CLOTH_MODEL_SOURCE_FILE || '',
  stagedModelPath = path.join(cwd, DEFAULT_STAGED_MODEL_PATH),
  stageProofPath = path.join(cwd, DEFAULT_STAGE_PROOF_PATH),
  buildProofPath = path.join(cwd, DEFAULT_BUILD_PROOF_PATH),
  commandRunner = runCommand,
  expectedModel = OFFICIAL_CLOTH_MODEL,
} = {}) => {
  const startedAt = new Date().toISOString();
  let stage = null;
  let outcome = null;
  try {
    stage = await stageClothModel({
      sourceFile,
      destinationPath: stagedModelPath,
      proofPath: stageProofPath,
      expectedModel,
    });
    const env = {
      ...process.env,
      VITE_REMBG_CLOTH_SEG_MODEL_URL: SAME_ORIGIN_CLOTH_MODEL_URL,
    };
    commandRunner(process.execPath, ['scripts/verify-rembg-model-deploy-readiness.mjs', '--require-cloth'], { env, cwd });
    commandRunner('npm', ['run', 'build'], { env, cwd });
    commandRunner(process.execPath, [
      'scripts/verify-rembg-model-deploy-readiness.mjs',
      '--require-cloth',
      '--verify-dist',
    ], { env, cwd });
    const distModelPath = path.join(cwd, 'dist/models/u2net_cloth_seg.onnx');
    const distIdentity = await readFileIdentity(distModelPath);
    outcome = {
      schema: 'heavy-chain-rembg-cloth-model-same-origin-build.v1',
      ok: true,
      status: 'built',
      startedAt,
      checkedAt: new Date().toISOString(),
      browserModelUrl: SAME_ORIGIN_CLOTH_MODEL_URL,
      stageProofPath,
      stageStatus: stage.status,
      distModelPath,
      model: distIdentity,
      cleanup: { stagedPublicModelRemoved: false },
      claims: {
        proves: ['same-origin URL embedded in build', 'dist model bytes', 'dist model SHA-256'],
        doesNotProve: ['production deploy', 'production GET', 'browser inference', 'semantic quality acceptance'],
      },
    };
    await writeProof(buildProofPath, outcome);
    return outcome;
  } catch (error) {
    outcome = {
      schema: 'heavy-chain-rembg-cloth-model-same-origin-build.v1',
      ok: false,
      status: 'failed',
      startedAt,
      checkedAt: new Date().toISOString(),
      browserModelUrl: SAME_ORIGIN_CLOTH_MODEL_URL,
      stageProofPath,
      stageStatus: stage?.status || null,
      exactBlocker: error instanceof Error ? error.message : String(error),
      cleanup: { stagedPublicModelRemoved: false },
    };
    await writeProof(buildProofPath, outcome);
    throw error;
  } finally {
    await fsp.rm(stagedModelPath, { force: true });
    if (outcome) {
      outcome.cleanup = { stagedPublicModelRemoved: !fs.existsSync(stagedModelPath) };
      await writeProof(buildProofPath, outcome);
    }
  }
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = parseArguments(process.argv);
  buildSameOriginClothModel({
    sourceFile: args['source-file'] || process.env.REMBG_CLOTH_MODEL_SOURCE_FILE || '',
    stageProofPath: args['stage-output'] || path.join(process.cwd(), DEFAULT_STAGE_PROOF_PATH),
    buildProofPath: args.output || path.join(process.cwd(), DEFAULT_BUILD_PROOF_PATH),
  }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      exactBlocker: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}

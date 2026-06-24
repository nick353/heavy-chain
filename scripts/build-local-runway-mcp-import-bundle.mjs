#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'heavy-chain.local-runway-mcp-import.v1';
const DEFAULT_LIMIT = 4;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const heavyChainRoot = path.resolve(__dirname, '..');

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const key = current.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
};

const usage = () => {
  console.error([
    'Usage:',
    '  node scripts/build-local-runway-mcp-import-bundle.mjs --manifest <generation_manifest.json> --out <bundle.json> [--feature-type campaign-image] [--brand-id <id>] [--limit 4]',
    '',
    'The manifest may use NisenPrints-style relative paths. Use --source-root when the manifest paths are relative to another root.',
  ].join('\n'));
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const maybeReadText = async (filePath) => {
  if (!filePath) return null;
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

const mimeFromPath = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const resolveManifestPath = async (sourceRoot, manifestDir, candidatePath) => {
  if (!candidatePath || typeof candidatePath !== 'string') return null;
  if (path.isAbsolute(candidatePath)) return candidatePath;
  const rootResolved = path.resolve(sourceRoot, candidatePath);
  if (await fileExists(rootResolved)) return rootResolved;
  const manifestResolved = path.resolve(manifestDir, candidatePath);
  if (await fileExists(manifestResolved)) return manifestResolved;
  return rootResolved;
};

const relativeOrAbsolute = (filePath) => {
  const relativeToHeavyChain = path.relative(heavyChainRoot, filePath);
  return relativeToHeavyChain.startsWith('..') ? filePath : relativeToHeavyChain;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest ? path.resolve(String(args.manifest)) : '';
  const outPath = args.out ? path.resolve(String(args.out)) : '';
  if (!manifestPath || !outPath) {
    usage();
    process.exit(2);
  }

  const manifest = await readJson(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const sourceRoot = args['source-root']
    ? path.resolve(String(args['source-root']))
    : path.resolve(manifestDir, '../../..');
  const featureType = typeof args['feature-type'] === 'string' ? args['feature-type'] : 'campaign-image';
  const limit = Number.isFinite(Number(args.limit))
    ? Math.max(1, Math.min(12, Number(args.limit)))
    : DEFAULT_LIMIT;

  const promptPath = await resolveManifestPath(sourceRoot, manifestDir, manifest.prompt_path);
  const promptText = await maybeReadText(promptPath);
  const imageEntries = [
    manifest.final_art_path ? { kind: 'final', imagePath: manifest.final_art_path } : null,
    ...(Array.isArray(manifest.candidate_paths)
      ? manifest.candidate_paths.map((imagePath, index) => ({ kind: `candidate-${index + 1}`, imagePath }))
      : []),
  ].filter(Boolean).slice(0, limit);

  const images = [];
  for (const [index, entry] of imageEntries.entries()) {
    const absoluteImagePath = await resolveManifestPath(sourceRoot, manifestDir, entry.imagePath);
    if (!absoluteImagePath) continue;
    const imageBytes = await fs.readFile(absoluteImagePath);
    const imageSha256 = sha256(imageBytes);
    images.push({
      id: `runway-local-${manifest.run_id || Date.now()}-${entry.kind}`,
      title: `${manifest.topic || 'Runway MCP local image'} ${entry.kind === 'final' ? 'final' : entry.kind}`,
      imageUrl: `data:${mimeFromPath(absoluteImagePath)};base64,${imageBytes.toString('base64')}`,
      prompt: promptText || manifest.page_prompt_excerpt || manifest.candidate_prompt_context_excerpt || null,
      featureType,
      metadata: {
        artifactKind: 'runway_local_image',
        lane: 'runway_mcp_local',
        localRunwayMcpWorker: true,
        noHostedBridge: true,
        source: 'nisenprints_generation_manifest',
        sourceManifestPath: relativeOrAbsolute(manifestPath),
        sourceImagePath: entry.imagePath,
        sourceImageSha256: imageSha256,
        sourceImageBytes: imageBytes.byteLength,
        sourceImageKind: entry.kind,
        model: manifest.model || null,
        runId: manifest.run_id || null,
        runDate: manifest.run_date || null,
        topic: manifest.topic || null,
        promptPath: manifest.prompt_path || null,
        promptSha256: manifest.prompt_sha256 || null,
        runwaySessionUrl: manifest.runway_session_url || null,
        finalArtPath: manifest.final_art_path || null,
        finalArtWasUpscaled: Boolean(manifest.final_art_was_upscaled),
      },
    });
  }

  if (!images.length) {
    throw new Error('No importable image files were found from the manifest.');
  }

  const bundle = {
    schema: SCHEMA,
    createdAt: new Date().toISOString(),
    brandId: typeof args['brand-id'] === 'string' ? args['brand-id'] : undefined,
    featureType,
    source: {
      kind: 'local_runway_mcp_worker_manifest',
      sourceManifestPath: relativeOrAbsolute(manifestPath),
      sourceRoot,
      runId: manifest.run_id || null,
      model: manifest.model || null,
      noHostedBridge: true,
    },
    images,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    outPath,
    imageCount: images.length,
    schema: SCHEMA,
    sourceManifestPath: manifestPath,
  }, null, 2));
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

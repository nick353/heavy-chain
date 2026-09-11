import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const STATIC_LIMIT = 25 * 1024 * 1024;
const STATIC_REFERENCE_EXTENSIONS = new Set([
  '.avif', '.gif', '.ico', '.jpeg', '.jpg', '.onnx', '.otf', '.png',
  '.svg', '.ttf', '.wasm', '.webp', '.woff', '.woff2',
]);
const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp']);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF_SIGNATURES = [Buffer.from('GIF87a'), Buffer.from('GIF89a')];
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

export function assetDescriptor(relativePath, bytes) {
  // Only ship oversized app models/runtime assets. Never publish arbitrary files.
  if (!/^assets\/[a-zA-Z0-9_.-]+\.(onnx|wasm)$/.test(relativePath)) {
    throw new Error(`Unexpected oversized file: ${relativePath}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    key: `build-assets/${sha256}${path.extname(relativePath)}`,
    size: bytes.length,
    sha256,
    contentType: relativePath.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
  };
}

async function walk(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink not permitted in build: ${target}`);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

function hasPrefix(bytes, signature) {
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function looksLikeHtml(bytes) {
  const prefix = bytes.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  return prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<head') || prefix.startsWith('<body');
}

/**
 * Validate the bytes that will be published at a static URL. This intentionally
 * checks bytes instead of trusting a pathname or Content-Type: Workers Static
 * Assets can label an SPA fallback using the requested image extension.
 */
export function inspectStaticAsset(relativePath, bytes, declaredContentType = null) {
  const extension = path.extname(relativePath).toLowerCase();
  const result = { path: relativePath, ok: true, reason: null };
  if (!IMAGE_EXTENSIONS.has(extension)) return result;

  if (declaredContentType && declaredContentType.toLowerCase().startsWith('text/html')) {
    return { ...result, ok: false, reason: 'html_content_type_for_image_path' };
  }
  if (looksLikeHtml(bytes)) return { ...result, ok: false, reason: 'html_bytes_for_image_path' };

  const valid = extension === '.png'
    ? hasPrefix(bytes, PNG_SIGNATURE)
    : extension === '.jpg' || extension === '.jpeg'
      ? hasPrefix(bytes, JPEG_SIGNATURE)
      : extension === '.gif'
        ? GIF_SIGNATURES.some(signature => hasPrefix(bytes, signature))
        : extension === '.webp'
          ? bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          : extension === '.ico'
            ? bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0
            : extension === '.avif'
              ? bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && bytes.subarray(8, 12).toString('ascii') === 'avif'
              : bytes.subarray(0, 256).toString('utf8').includes('<svg');
  if (!valid) return { ...result, ok: false, reason: `invalid_${extension.slice(1)}_signature` };
  return result;
}

function staticReferenceFromMatch(match) {
  const value = match[2];
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const extension = path.extname(withoutQuery).toLowerCase();
  return STATIC_REFERENCE_EXTENSIONS.has(extension) ? withoutQuery : null;
}

/**
 * Scan the generated site for literal public static references and verify both
 * resolution and image bytes before Wrangler sees the package. Dynamic or
 * external URLs are intentionally not guessed here.
 */
export async function validateStaticReferences(site) {
  const files = await walk(site);
  const references = new Set();
  const referencePattern = /(['"`])(\/[^'"`\\\s?#]+\.[a-z0-9]+)(?:[?#][^'"`\\]*)?\1/gi;
  for (const file of files) {
    if (!/\.(?:css|html|js|json|mjs)$/i.test(file)) continue;
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(referencePattern)) {
      const reference = staticReferenceFromMatch(match);
      if (reference) references.add(reference);
    }
  }

  const unresolved = [];
  const invalid = [];
  for (const reference of [...references].sort()) {
    const localPath = path.resolve(site, `.${reference}`);
    const sitePrefix = `${path.resolve(site)}${path.sep}`;
    if (!localPath.startsWith(sitePrefix)) {
      unresolved.push({ path: reference, reason: 'outside_site' });
      continue;
    }
    let bytes;
    try {
      bytes = await fs.readFile(localPath);
    } catch {
      unresolved.push({ path: reference, reason: 'missing_file' });
      continue;
    }
    const inspection = inspectStaticAsset(reference, bytes);
    if (!inspection.ok) invalid.push(inspection);
  }
  return {
    ok: unresolved.length === 0 && invalid.length === 0,
    references: [...references].sort(),
    unresolved,
    invalid,
  };
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`);
}

export async function build() {
  const env = {
    ...process.env,
    VITE_CLOUDFLARE_API_ENABLED: 'true',
    VITE_CLOUDFLARE_API_BASE_URL: 'https://heavy-chain-api.nichika2000823.workers.dev',
    VITE_MEDIA_PROVIDER_ORDER: 'cloudflare_r2',
    VITE_MEDIA_GATEWAY_URL: 'https://heavy-chain-api.nichika2000823.workers.dev',
  };
  const site = path.join(here, '.build/site');
  run(path.join(root, 'node_modules/.bin/tsc'), ['-b'], env);
  run(path.join(root, 'node_modules/.bin/vite'), ['build', '--outDir', site], env);
  const staticValidation = await validateStaticReferences(site);
  if (!staticValidation.ok) {
    throw new Error(`Static asset validation failed: ${JSON.stringify(staticValidation, null, 2)}`);
  }
  // Legacy Pages/Zeabur wildcard rewrites conflict with Workers' HTML
  // canonicalization. The Workers assets binding already handles SPA routes.
  await fs.writeFile(path.join(site, '_redirects'), '# SPA fallback is configured in the Workers assets binding.\n');
  const manifest = {};
  for (const file of await walk(site)) {
    if ((await fs.stat(file)).size <= STATIC_LIMIT) continue;
    const relative = path.relative(site, file).split(path.sep).join('/');
    const bytes = await fs.readFile(file);
    manifest[`/${relative}`] = assetDescriptor(relative, bytes);
  }
  // Wrangler excludes these generated files from Static Assets; upload them to
  // the separate R2 app-asset bucket before deploying the generated config.
  await fs.writeFile(path.join(site, '.assetsignore'), Object.keys(manifest).map(x => x.slice(1)).join('\n') + '\n');
  const config = {
    name: 'heavy-chain-web',
    account_id: 'ffa9a931fec21b22273fd2c311bb771d',
    main: '../src/index.mjs',
    compatibility_date: '2026-09-05',
    workers_dev: true,
    preview_urls: false,
    assets: { directory: './site', binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/_health', '/api/auth/*', '/reset-password', ...Object.keys(manifest)] },
    services: [{ binding: 'AUTH_SERVICE', service: 'consumer-auth' }],
    r2_buckets: [{ binding: 'PUBLIC_ASSETS', bucket_name: 'heavy-chain-public-assets' }],
    vars: { PUBLIC_ASSETS_JSON: JSON.stringify(manifest) },
  };
  await fs.writeFile(path.join(here, '.build/wrangler.json'), JSON.stringify(config, null, 2) + '\n');
  await fs.writeFile(path.join(here, '.build/public-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ worker: config.name, largeAssets: manifest, auth: 'cloudflare', media: 'cloudflare_r2' }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await build();

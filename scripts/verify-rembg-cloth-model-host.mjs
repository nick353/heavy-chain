#!/usr/bin/env node
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OFFICIAL_CLOTH_MODEL } from './verify-rembg-cloth-model-compatibility.mjs';

const DEFAULT_BROWSER_ORIGIN = 'https://heavy-chain.zeabur.app';
const ALLOWED_CONTENT_TYPES = new Set([
  'application/octet-stream',
  'application/onnx',
  'application/x-onnx',
  'binary/octet-stream',
]);

const parseArguments = (argv) => Object.fromEntries(argv.slice(2).map((argument) => {
  const separator = argument.indexOf('=');
  return separator === -1
    ? [argument.replace(/^--/, ''), true]
    : [argument.slice(0, separator).replace(/^--/, ''), argument.slice(separator + 1)];
}));

const normalizeHostname = (hostname) => hostname.replace(/^\[|\]$/g, '').toLowerCase();

const isLoopbackHostname = (hostname) => {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
};

const isPublicIpv4Address = (address) => {
  const [a, b, c] = address.split('.').map(Number);
  return !(
    a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
  );
};

const decodeMappedIpv4Address = (address) => {
  if (!address.startsWith('::ffff:')) return null;
  const suffix = address.slice('::ffff:'.length);
  if (net.isIP(suffix) === 4) return suffix;
  const groups = suffix.split(':');
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  const value = (Number.parseInt(groups[0], 16) * 0x1_0000) + Number.parseInt(groups[1], 16);
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
};

export const isPublicIpAddress = (address) => {
  const normalized = normalizeHostname(address);
  const family = net.isIP(normalized);
  if (family === 4) {
    return isPublicIpv4Address(normalized);
  }
  if (family === 6) {
    const mappedIpv4 = decodeMappedIpv4Address(normalized);
    if (mappedIpv4) return isPublicIpv4Address(mappedIpv4);
    const firstGroup = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
    return !(
      normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || (firstGroup & 0xffc0) === 0xfec0
      || normalized.startsWith('ff')
      || firstGroup < 0x2000
      || firstGroup > 0x3fff
      || /^2001:0{0,3}:/.test(normalized)
      || normalized.startsWith('2001:db8:')
      || normalized.startsWith('2002:')
    );
  }
  return false;
};

export const validatePublicModelUrl = (value, { allowHttpLocalhost = false } = {}) => {
  if (!value) throw new Error('cloth_model_host_url_missing');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('cloth_model_host_url_invalid');
  }
  if (parsed.username || parsed.password) throw new Error('cloth_model_host_credentials_forbidden');
  if (parsed.search || parsed.hash) throw new Error('cloth_model_host_query_or_fragment_forbidden');
  const localHttpAllowed = allowHttpLocalhost
    && parsed.protocol === 'http:'
    && isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== 'https:' && !localHttpAllowed) throw new Error('cloth_model_host_https_required');
  const normalizedHostname = normalizeHostname(parsed.hostname);
  if (!allowHttpLocalhost && (
    normalizedHostname === 'localhost'
    || normalizedHostname.endsWith('.localhost')
    || normalizedHostname.endsWith('.local')
    || (net.isIP(normalizedHostname) && !isPublicIpAddress(normalizedHostname))
  )) throw new Error('cloth_model_host_public_address_required');
  if (!parsed.pathname.toLowerCase().endsWith('.onnx')) throw new Error('cloth_model_host_onnx_path_required');
  return parsed;
};

const assertPublicResolvedAddresses = async (parsed, { allowHttpLocalhost, lookupImpl }) => {
  if (allowHttpLocalhost && isLoopbackHostname(parsed.hostname)) return [];
  let addresses;
  try {
    addresses = await lookupImpl(normalizeHostname(parsed.hostname), { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`cloth_model_host_dns_lookup_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('cloth_model_host_dns_lookup_empty');
  }
  const nonPublic = addresses.map(({ address }) => address).filter((address) => !isPublicIpAddress(address));
  if (nonPublic.length > 0) throw new Error('cloth_model_host_public_address_required');
  return addresses.map(({ address, family }) => ({ address, family }));
};

export const createPinnedLookup = (resolvedAddresses) => (hostname, options, callback) => {
  const requestedFamily = typeof options === 'number' ? options : options?.family;
  const candidates = requestedFamily
    ? resolvedAddresses.filter(({ family }) => family === requestedFamily)
    : resolvedAddresses;
  if (candidates.length === 0) {
    callback(new Error(`cloth_model_host_pinned_address_family_unavailable:${requestedFamily || 'any'}`));
    return;
  }
  if (typeof options === 'object' && options?.all) {
    callback(null, candidates);
    return;
  }
  callback(null, candidates[0].address, candidates[0].family);
};

const fetchPinnedHttps = (parsed, { origin, signal, resolvedAddresses }) => new Promise((resolve, reject) => {
  const request = https.request(parsed, {
    method: 'GET',
    headers: { Origin: origin },
    signal,
    servername: normalizeHostname(parsed.hostname),
    lookup: createPinnedLookup(resolvedAddresses),
  }, (response) => {
    resolve({
      status: response.statusCode || 0,
      headers: new Headers(response.headers),
      body: response,
      url: parsed.href,
      connectedAddress: response.socket.remoteAddress || null,
    });
  });
  request.once('error', reject);
  request.end();
});

const sanitizeUrl = (value) => {
  const parsed = new URL(value);
  return `${parsed.origin}${parsed.pathname}`;
};

const normalizeContentType = (value) => String(value || '').split(';', 1)[0].trim().toLowerCase();

export const verifyClothModelHost = async ({
  url,
  outputPath,
  browserOrigin = DEFAULT_BROWSER_ORIGIN,
  expectedBytes = OFFICIAL_CLOTH_MODEL.bytes,
  expectedSha256 = OFFICIAL_CLOTH_MODEL.sha256,
  allowHttpLocalhost = false,
  timeoutMilliseconds = 180_000,
  fetchImpl = null,
  pinnedHttpsImpl = fetchPinnedHttps,
  lookupImpl = dns.lookup,
}) => {
  if (!outputPath) throw new Error('cloth_model_host_output_path_missing');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.rm(outputPath, { force: true });
  await fs.writeFile(outputPath, `${JSON.stringify({
    schema: 'heavy-chain-rembg-cloth-model-host.v1',
    ok: false,
    status: 'running',
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);

  let controller;
  let fetchTimeout;
  try {
    const parsed = validatePublicModelUrl(url, { allowHttpLocalhost });
    const resolvedAddresses = await assertPublicResolvedAddresses(parsed, { allowHttpLocalhost, lookupImpl });
    if (fetchImpl && !allowHttpLocalhost) throw new Error('cloth_model_host_custom_fetch_forbidden');
    const origin = new URL(browserOrigin).origin;
    controller = new AbortController();
    fetchTimeout = setTimeout(() => controller.abort(new Error('cloth_model_host_fetch_timeout')), timeoutMilliseconds);
    let response;
    try {
      response = fetchImpl
        ? await fetchImpl(parsed, {
            method: 'GET',
            redirect: 'manual',
            headers: { Origin: origin },
            signal: controller.signal,
          })
        : parsed.protocol === 'https:'
          ? await pinnedHttpsImpl(parsed, { origin, signal: controller.signal, resolvedAddresses })
          : await fetch(parsed, {
              method: 'GET',
              redirect: 'manual',
              headers: { Origin: origin },
              signal: controller.signal,
            });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('cloth_model_host_fetch_timeout');
      throw new Error(`cloth_model_host_fetch_failed:${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`cloth_model_host_redirect_forbidden:${response.status}`);
    }
    if (response.status !== 200) throw new Error(`cloth_model_host_http_status:${response.status}`);

    const accessControlAllowOrigin = response.headers.get('access-control-allow-origin');
    if (accessControlAllowOrigin !== '*' && accessControlAllowOrigin !== origin) {
      throw new Error(`cloth_model_host_cors_mismatch:${accessControlAllowOrigin || 'missing'}`);
    }
    const contentType = normalizeContentType(response.headers.get('content-type'));
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new Error(`cloth_model_host_content_type_invalid:${contentType || 'missing'}`);
    }
    const declaredLengthValue = response.headers.get('content-length');
    if (declaredLengthValue !== null && !/^\d+$/.test(declaredLengthValue)) {
      throw new Error(`cloth_model_host_content_length_invalid:${declaredLengthValue}`);
    }
    const declaredLength = declaredLengthValue === null ? null : Number.parseInt(declaredLengthValue, 10);
    if (declaredLength !== null && declaredLength !== expectedBytes) {
      throw new Error(`cloth_model_host_content_length_mismatch:${declaredLength}:${expectedBytes}`);
    }
    if (!response.body) throw new Error('cloth_model_host_body_missing');

    const digest = crypto.createHash('sha256');
    let receivedBytes = 0;
    for await (const chunk of response.body) {
      receivedBytes += chunk.byteLength;
      if (receivedBytes > expectedBytes) {
        throw new Error(`cloth_model_host_body_too_large:${receivedBytes}:${expectedBytes}`);
      }
      digest.update(chunk);
    }
    if (receivedBytes !== expectedBytes) {
      throw new Error(`cloth_model_host_body_size_mismatch:${receivedBytes}:${expectedBytes}`);
    }
    const sha256 = digest.digest('hex');
    if (sha256 !== expectedSha256) {
      throw new Error(`cloth_model_host_sha256_mismatch:${sha256}:${expectedSha256}`);
    }
    clearTimeout(fetchTimeout);

    const result = {
      schema: 'heavy-chain-rembg-cloth-model-host.v1',
      ok: true,
      status: 'verified',
      checkedAt: new Date().toISOString(),
      requestedUrl: sanitizeUrl(parsed),
      finalUrl: sanitizeUrl(response.url || parsed),
      browserOrigin: origin,
      resolvedAddresses,
      connectedAddress: response.connectedAddress || null,
      response: {
        status: response.status,
        contentType,
        accessControlAllowOrigin,
        declaredLength,
        receivedBytes,
        sha256,
      },
      proves: ['HTTPS public model URL with public DNS addresses', 'no redirect chain', 'browser-origin CORS', 'HTTP 200 full response size', 'pinned SHA-256'],
      doesNotProve: ['browser ONNX initialization', 'semantic mask quality', '0713 video equivalence'],
    };
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    if (fetchTimeout) clearTimeout(fetchTimeout);
    if (controller && !controller.signal.aborted) controller.abort();
    const failure = {
      schema: 'heavy-chain-rembg-cloth-model-host.v1',
      ok: false,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      exactBlocker: error instanceof Error ? error.message : String(error),
    };
    await fs.writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const args = parseArguments(process.argv);
  verifyClothModelHost({
    url: args.url || process.env.VITE_REMBG_CLOTH_SEG_MODEL_URL || '',
    outputPath: args.output,
    browserOrigin: args.origin || DEFAULT_BROWSER_ORIGIN,
    allowHttpLocalhost: false,
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

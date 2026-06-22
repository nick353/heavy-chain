#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const DEFAULT_WORKSPACES = ['patterns', 'studio', 'video', 'lab'];
const GENERATED_IMAGES_BUCKET = 'generated-images';
const PAGE_SIZE = 1000;
const MAX_ROWS_PER_TABLE = 10000;
const MAX_TELEMETRY_INFERENCE_DISTANCE_MS = 5 * 60 * 1000;

const args = parseArgs(process.argv.slice(2));
const now = new Date();
const defaultOut = `output/playwright/production-workspace-generation-${dateStamp(now)}/workspace-db-readback.json`;
const outPath = args.out ?? defaultOut;
const workspaces = parseList(args.workspaces, DEFAULT_WORKSPACES);

if (!args.since || Number.isNaN(Date.parse(args.since))) {
  console.error('--since <iso-timestamp> is required so production readback stays bounded to the approved live run.');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SERVICE_ROLE_KEY. Secret values were not printed.',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const metadata = {
  captured_at: now.toISOString(),
  release_date: args.expectReleaseDate ?? null,
  environment: args.expectEnvironment ?? null,
  git_commit: args.expectGitCommit ?? null,
  since: args.since ?? null,
  workspaces,
  collector: 'collect-workspace-live-readback',
  collector_mode: 'read-only-select-and-createSignedUrl',
};

const jobs = await selectRows('generation_jobs', 'created_at');
const images = await selectRows('generated_images', 'created_at');
const usage = await selectRows('usage_events', 'created_at');
const runs = await selectRows('edge_function_runs', 'created_at');

const filteredJobs = filterWorkspaceRows(jobs);
const filteredImages = filterWorkspaceRows(images).filter((image) => {
  if (!filteredJobs.length) return true;
  if (!image.job_id) return true;
  return filteredJobs.some((job) => job.id === image.job_id);
});
const sourceEvents = buildSourceEvents(filteredJobs, filteredImages);
const requestIds = new Set([
  ...filteredJobs.map(requestIdFor).filter(isNonEmptyString),
  ...filteredImages.map(requestIdFor).filter(isNonEmptyString),
]);
const filteredUsage = filterTelemetryRows(usage, requestIds, sourceEvents);
const filteredRuns = filterTelemetryRows(runs, requestIds, sourceEvents);
const storage = await collectStorageReadback(filteredImages);

const readback = redactSecrets({
  metadata,
  counts: {
    jobs: filteredJobs.length,
    images: filteredImages.length,
    usage: filteredUsage.length,
    runs: filteredRuns.length,
    storage: storage.length,
  },
  jobs: filteredJobs.map(projectJob),
  images: filteredImages.map(projectImage),
  usage: filteredUsage.map((row) => projectUsage(row, inferTelemetrySource(row, sourceEvents))),
  runs: filteredRuns.map((row) => projectRun(row, inferTelemetrySource(row, sourceEvents))),
  storage,
});

const raw = JSON.stringify(readback, null, 2);
if (containsLikelySecret(raw)) {
  console.error('Collector output contained a likely secret after redaction; refusing to write.');
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${raw}\n`);
console.log(`Workspace readback written to ${outPath}. Secret values were not printed.`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--out' && next) parsed.out = next;
    if (arg === '--since' && next) parsed.since = next;
    if (arg === '--expect-release-date' && next) parsed.expectReleaseDate = next;
    if (arg === '--expect-environment' && next) parsed.expectEnvironment = next;
    if (arg === '--expect-git-commit' && next) parsed.expectGitCommit = next;
    if (arg === '--workspaces' && next) parsed.workspaces = next;
    if (arg.startsWith('--') && next) index += 1;
  }
  return parsed;
}

function parseList(value, fallback) {
  if (!value) return fallback;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : fallback;
}

function dateStamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

async function selectRows(table, orderColumn) {
  const rows = [];
  for (let from = 0; from < MAX_ROWS_PER_TABLE; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gte(orderColumn, args.since)
      .order(orderColumn, { ascending: false })
      .range(from, to);
    if (error) {
      console.error(`${table}: select failed: ${error.message}`);
      process.exit(1);
    }
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  if (rows.length >= MAX_ROWS_PER_TABLE) {
    console.error(`${table}: readback exceeded ${MAX_ROWS_PER_TABLE} rows; narrow --since and rerun.`);
    process.exit(1);
  }

  return rows;
}

function filterWorkspaceRows(rows) {
  return rows.filter((row) => {
    const source = sourceInfo(row);
    return source.sourceWorkspace && workspaces.includes(source.sourceWorkspace);
  });
}

function filterTelemetryRows(rows, requestIds, events) {
  return rows.filter((row) => {
    const source = sourceInfo(row);
    if (source.sourceWorkspace && workspaces.includes(source.sourceWorkspace)) return true;
    if (isNonEmptyString(row.request_id) && requestIds.has(row.request_id)) return true;
    return Boolean(inferTelemetrySource(row, events).sourceWorkspace);
  });
}

function buildSourceEvents(jobRows, imageRows) {
  const events = [];
  for (const row of [...jobRows, ...imageRows]) {
    const source = sourceInfo(row);
    const at = Date.parse(row.created_at ?? row.completed_at ?? '');
    if (!source.sourceWorkspace || !source.workflowVersion || Number.isNaN(at)) continue;
    events.push({
      sourceWorkspace: source.sourceWorkspace,
      workflowVersion: source.workflowVersion,
      brand_id: row.brand_id ?? null,
      user_id: row.user_id ?? null,
      request_id: requestIdFor(row),
      at,
    });
  }
  return events;
}

function inferTelemetrySource(row, events) {
  const direct = sourceInfo(row);
  if (direct.sourceWorkspace && direct.workflowVersion) return direct;
  if (isNonEmptyString(row.request_id)) {
    const requestMatch = events.find((event) => event.request_id === row.request_id);
    if (requestMatch) {
      return {
        sourceWorkspace: requestMatch.sourceWorkspace,
        workflowVersion: requestMatch.workflowVersion,
      };
    }
  }

  const rowAt = Date.parse(row.started_at ?? row.completed_at ?? row.created_at ?? '');
  if (Number.isNaN(rowAt)) return {};
  const functionName = row.function_name;
  const candidates = events
    .filter((event) => {
      if (row.brand_id && event.brand_id && row.brand_id !== event.brand_id) return false;
      if (row.user_id && event.user_id && row.user_id !== event.user_id) return false;
      if (functionName === 'design-gacha') return event.sourceWorkspace === 'patterns';
      if (functionName === 'generate-image') return ['studio', 'video', 'lab'].includes(event.sourceWorkspace);
      if (functionName === 'model-matrix') return event.sourceWorkspace === 'studio';
      return ['patterns', 'studio', 'video', 'lab'].includes(event.sourceWorkspace);
    })
    .map((event) => ({ ...event, distance: Math.abs(rowAt - event.at) }))
    .sort((a, b) => a.distance - b.distance);

  const match = candidates[0];
  if (!match || match.distance > MAX_TELEMETRY_INFERENCE_DISTANCE_MS) return {};
  return {
    sourceWorkspace: match.sourceWorkspace,
    workflowVersion: match.workflowVersion,
  };
}

async function collectStorageReadback(images) {
  const paths = [...new Set(images.map((image) => image.storage_path).filter(isNonEmptyString))];
  const rows = [];

  for (const storagePath of paths) {
    const { data, error } = await supabase.storage.from(GENERATED_IMAGES_BUCKET).createSignedUrl(storagePath, 60);
    const image = images.find((row) => row.storage_path === storagePath);
    const source = sourceInfo(image ?? {});
    rows.push({
      storage_path: storagePath,
      bucket: GENERATED_IMAGES_BUCKET,
      image_id: image?.id ?? null,
      job_id: image?.job_id ?? null,
      sourceWorkspace: source.sourceWorkspace ?? null,
      workflowVersion: source.workflowVersion ?? null,
      signedUrlOk: Boolean(data?.signedUrl && !error),
      signedUrlExpiresIn: 60,
      signedUrlError: error?.message ?? null,
    });
  }

  return rows;
}

function projectJob(row) {
  const source = sourceInfo(row);
  return {
    id: row.id,
    brand_id: row.brand_id,
    user_id: row.user_id,
    feature_type: row.feature_type,
    status: row.status,
    error_message: row.error_message ?? null,
    created_at: row.created_at ?? null,
    completed_at: row.completed_at ?? null,
    sourceWorkspace: source.sourceWorkspace ?? null,
    workflowVersion: source.workflowVersion ?? null,
    request_id: requestIdFor(row),
    input_params: row.input_params ?? {},
  };
}

function projectImage(row) {
  const source = sourceInfo(row);
  return {
    id: row.id,
    job_id: row.job_id ?? null,
    brand_id: row.brand_id,
    user_id: row.user_id,
    storage_path: row.storage_path,
    image_url: isNonEmptyString(row.image_url) ? '[present-redacted]' : null,
    feature_type: row.feature_type ?? null,
    model_used: row.model_used ?? null,
    created_at: row.created_at ?? null,
    sourceWorkspace: source.sourceWorkspace ?? null,
    workflowVersion: source.workflowVersion ?? null,
    request_id: requestIdFor(row),
    generation_params: row.generation_params ?? {},
    metadata: row.metadata ?? {},
  };
}

function projectUsage(row, sourceOverride = null) {
  const source = sourceOverride ?? sourceInfo(row);
  return {
    id: row.id,
    brand_id: row.brand_id,
    user_id: row.user_id,
    function_name: row.function_name,
    units: row.units,
    status: row.status,
    request_id: row.request_id ?? null,
    created_at: row.created_at ?? null,
    completed_at: row.completed_at ?? null,
    sourceWorkspace: source.sourceWorkspace ?? null,
    workflowVersion: source.workflowVersion ?? null,
    metadata: row.metadata ?? {},
  };
}

function projectRun(row, sourceOverride = null) {
  const source = sourceOverride ?? sourceInfo(row);
  return {
    id: row.id,
    usage_event_id: row.usage_event_id ?? null,
    brand_id: row.brand_id ?? null,
    user_id: row.user_id ?? null,
    function_name: row.function_name,
    status: row.status,
    request_id: row.request_id ?? null,
    duration_ms: row.duration_ms ?? null,
    error_message: row.error_message ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    created_at: row.created_at ?? null,
    sourceWorkspace: source.sourceWorkspace ?? null,
    workflowVersion: source.workflowVersion ?? null,
    metadata: row.metadata ?? {},
  };
}

function sourceInfo(row) {
  const candidates = [
    row.sourceReadback,
    row.generationIntent,
    row.input_params,
    row.input_params?.sourceReadback,
    row.input_params?.generationIntent,
    row.input_params?.generationIntent?.sourceReadback,
    row.metadata,
    row.metadata?.sourceReadback,
    row.metadata?.generationIntent,
    row.metadata?.generationIntent?.sourceReadback,
    row.generation_params,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const sourceWorkspace = readString(candidate, 'sourceWorkspace');
    const workflowVersion = readString(candidate, 'workflowVersion');
    if (sourceWorkspace || workflowVersion) return { sourceWorkspace, workflowVersion };
  }
  return {};
}

function readString(value, key) {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item.trim() : null;
}

function requestIdFor(row) {
  return (
    readString(row, 'request_id') ||
    readString(row, 'requestId') ||
    readString(row.input_params, 'requestId') ||
    readString(row.input_params, 'request_id') ||
    readString(row.metadata, 'requestId') ||
    readString(row.metadata, 'request_id') ||
    null
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && containsLikelySecret(value)) return '[redacted]';
    return value;
  }

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (/secret|service_role|token|api[_-]?key|authorization/i.test(key) || /^signed_?url$/i.test(key)) {
      next[key] = '[redacted]';
    } else {
      next[key] = redactSecrets(item);
    }
  }
  return next;
}

function containsLikelySecret(raw) {
  const patterns = [
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
    /sk-[A-Za-z0-9_-]{20,}/,
    /service_role[_-]?[A-Za-z0-9_-]{20,}/i,
    /AIza[0-9A-Za-z_-]{20,}/,
    /sb_secret_[A-Za-z0-9_-]{20,}/i,
  ];
  return patterns.some((pattern) => pattern.test(raw));
}

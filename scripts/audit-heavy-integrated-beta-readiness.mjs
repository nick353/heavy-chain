import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');
const LEDGER_PATH = resolve(REPO_ROOT, 'work/lightchain-parity-behavior-ledger-current.json');
const REQUIRED_LAYERS = ['input', 'screen', 'generation', 'result', 'save', 'reuse', 'error', 'performance'];
const PRIORITY_ROWS = ['fabric-image', 'printing-image', 'ai-fitting'];
const VIDEO_ROWS = ['video-workstation', 'video-detail'];

const countStatuses = (records) => records
  .flatMap((record) => Object.values(record.layers))
  .reduce((counts, layer) => {
    counts[layer.status] = (counts[layer.status] ?? 0) + 1;
    return counts;
  }, {});

export const buildIntegratedBetaReadinessReport = (ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))) => {
  const records = Array.isArray(ledger.records) ? ledger.records : [];
  const errors = [];

  if (ledger.schema !== 'light-heavy-parity-behavior-ledger.v2') errors.push('ledger_schema_invalid');
  if (ledger.scope?.nonVideoRows !== 31) errors.push('non_video_scope_must_be_31');
  if (JSON.stringify(ledger.scope?.excludedVideoRows ?? []) !== JSON.stringify(VIDEO_ROWS)) {
    errors.push('video_exclusion_scope_invalid');
  }
  if (records.length !== 31) errors.push('record_count_must_be_31');

  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record.rowId !== 'string' || ids.has(record.rowId)) {
      errors.push('row_identity_invalid_or_duplicate');
      continue;
    }
    ids.add(record.rowId);
    if (VIDEO_ROWS.includes(record.rowId)) errors.push('video_row_present');
    const layerKeys = Object.keys(record.layers ?? {});
    if (layerKeys.length !== REQUIRED_LAYERS.length || !REQUIRED_LAYERS.every((layer) => layerKeys.includes(layer))) {
      errors.push(`layer_set_invalid:${record.rowId}`);
    }
  }

  const statuses = countStatuses(records);
  const productionPromotionDisabled = ledger.evidenceBoundary?.productionPromotion
    === 'disabled_until_current_same_run_lightchain_and_heavy_readback';
  if (!productionPromotionDisabled) errors.push('production_promotion_boundary_missing');

  const priority = Object.fromEntries(PRIORITY_ROWS.map((rowId) => {
    const record = records.find((candidate) => candidate.rowId === rowId);
    return [rowId, record ? Object.fromEntries(REQUIRED_LAYERS.map((layer) => [layer, record.layers[layer]?.status ?? 'missing'])) : null];
  }));

  const sourceReadback = ledger.evidenceBoundary?.sourceReadback;
  const localContract = ledger.evidenceBoundary?.localHeavyContract;
  const sourceReadbackPresent = typeof sourceReadback === 'string' && existsSync(resolve(REPO_ROOT, sourceReadback));
  const localContractPresent = typeof localContract === 'string' && existsSync(resolve(REPO_ROOT, localContract));
  if (!sourceReadbackPresent) errors.push('source_readback_artifact_missing');
  if (!localContractPresent) errors.push('local_contract_artifact_missing');

  const pendingProductionLayers = (statuses.PENDING_CONFIRMATION ?? 0) + (statuses.unknown ?? 0);
  const verifiedProductionLayers = statuses['verified-production'] ?? 0;

  return {
    schema: 'heavy-chain.integrated-beta-readiness.v1',
    capturedAt: new Date().toISOString(),
    status: errors.length === 0 ? 'implemented_local' : 'invalid_current_ledger',
    productionParity: verifiedProductionLayers > 0 && pendingProductionLayers === 0
      ? 'verified'
      : 'PENDING_CONFIRMATION',
    goalState: 'active',
    scope: {
      nonVideoRows: records.length,
      excludedVideoRows: VIDEO_ROWS,
      layers: REQUIRED_LAYERS,
    },
    evidence: {
      productionPromotionDisabled,
      sourceReadbackPresent,
      localContractPresent,
      verifiedLocalLayers: statuses['verified-local'] ?? 0,
      pendingProductionLayers,
      verifiedProductionLayers,
    },
    priority,
    errors: [...new Set(errors)],
    nextGate: 'fresh_same_run_lightchain_and_heavy_readback',
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = buildIntegratedBetaReadinessReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // This is an incomplete-tolerant audit: an active pending goal is a valid
  // result and must not be confused with a failed implementation check.
  process.exitCode = report.status === 'implemented_local' ? 0 : 1;
}

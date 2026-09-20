import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  NON_VIDEO_PARITY_ROW_IDS,
  PARITY_BEHAVIOR_LEDGER_SCHEMA,
  PARITY_BEHAVIOR_LAYERS,
  type ParityBehaviorLayer,
  type ParityBehaviorLedgerRecord,
  type ParityBehaviorStatus,
  validateParityBehaviorLedger,
} from '../src/features/lightchain/parityBehaviorLedger.ts';

const scriptArgs = process.argv.slice(2);
const includeHistoricalProduction = scriptArgs.includes('--include-historical-production');
const outputArg = scriptArgs.find((arg) => !arg.startsWith('--'));
const outputPath = resolve(outputArg || 'work/lightchain-parity-behavior-ledger-current.json');
const sourceReadbackArg = scriptArgs.find((arg) => arg.startsWith('--source-readback='));
if (!sourceReadbackArg) {
  throw new Error('parity_behavior_source_readback_required');
}
const sourceReadback = sourceReadbackArg.slice('--source-readback='.length).trim();
if (!sourceReadback || !existsSync(resolve(sourceReadback))) {
  throw new Error(`parity_behavior_source_readback_missing:${sourceReadback || 'empty'}`);
}
const localInputEvidence = ['work/heavy-local-workflow-lifecycle-retry-readback-20260821-r209.md'];
const localScreenEvidence = ['work/heavy-local-all-feature-verification-20260824-r4.md'];
const pendingNote = 'Current same-run Lightchain↔Heavy evidence is not yet available for this layer; local route reach or a historical artifact is not promoted to current parity proof.';

type LayerOverride = Partial<Record<ParityBehaviorLayer, { status: ParityBehaviorStatus; evidence: string[]; note: string }>>;

const overrides: Record<string, LayerOverride> = {
  'ai-fitting': production({
    input: ['work/heavy-chain-ai-fitting-end-to-end-profile2-20260821-r348.md', 'work/heavy-ai-fitting-r335-svg-raster-readback-20260821.md'],
    generation: ['work/heavy-chain-ai-fitting-end-to-end-profile2-20260821-r348.md', 'work/heavy-ai-fitting-r335-svg-raster-readback-20260821.md'],
    result: ['work/heavy-chain-ai-fitting-end-to-end-profile2-20260821-r348.md', 'work/heavy-ai-fitting-r335-svg-raster-readback-20260821.md'],
    save: ['work/heavy-chain-ai-fitting-end-to-end-profile2-20260821-r348.md', 'work/heavy-ai-fitting-r335-svg-raster-readback-20260821.md'],
    reuse: ['work/heavy-chain-ai-fitting-end-to-end-profile2-20260821-r348.md', 'work/heavy-ai-fitting-r335-svg-raster-readback-20260821.md'],
  }),
  'printing-image': production({
    input: ['work/heavy-printing-image-production-readback-20260821-r188.md'],
    generation: ['work/heavy-printing-image-production-readback-20260821-r188.md'],
    result: ['work/heavy-printing-image-production-readback-20260821-r188.md'],
    save: ['work/heavy-printing-image-production-readback-20260821-r188.md'],
    reuse: ['work/heavy-printing-image-production-readback-20260821-r188.md'],
  }),
  'fabric-image': {
    input: productionLayer(['work/heavy-chain-fabric-end-to-end-profile2-20260821-r347.md'], 'Fresh same-run fabric workflow selected library inputs and passed the rights boundary.'),
    generation: productionLayer(['work/heavy-chain-fabric-end-to-end-profile2-20260821-r347.md'], 'Fresh same-run provider generation completed with a fabric-image result.'),
    result: productionLayer(['work/heavy-chain-fabric-end-to-end-profile2-20260821-r347.md'], 'Fresh same-run fabric result was read back at 1024x1536px.'),
    save: productionLayer(['work/heavy-chain-fabric-end-to-end-profile2-20260821-r347.md'], 'Fresh same-run fabric result was saved to Canvas and server-confirmed.'),
    reuse: productionLayer(['work/heavy-chain-fabric-end-to-end-profile2-20260821-r347.md'], 'Fresh same-run Canvas reload restored the fabric result and server-confirmed state.'),
  },
  'model-face': {
    input: productionLayer(['work/heavy-model-face-production-readback-20260821-r189.md'], 'Library input and rights gate were read back in the production slice.'),
    generation: productionLayer(['work/heavy-model-face-production-readback-20260821-r189.md'], 'Provider generation and completed result were read back.'),
    result: productionLayer(['work/heavy-model-face-production-readback-20260821-r189.md'], 'Result, History, Jobs, and Gallery were read back.'),
  },
  'model-change': {
    input: productionLayer(['work/heavy-model-change-production-readback-20260821-r190.md'], 'Library input and rights gate were read back in the production slice.'),
    generation: productionLayer(['work/heavy-model-change-production-readback-20260821-r190.md'], 'Provider generation and completed result were read back.'),
    result: productionLayer(['work/heavy-model-change-production-readback-20260821-r190.md'], 'Result, History, Jobs, and Gallery were read back.'),
  },
};

const localPriorityOverrides: Record<string, LayerOverride> = {
  'fabric-image': local({
    generation: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    result: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    save: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    reuse: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    error: ['work/heavy-priority-error-recovery-contracts-20260826-r135.md'],
    performance: ['work/heavy-local-priority-performance-qa-20260826-r137.md'],
  }),
  'ai-fitting': local({
    generation: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    result: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    save: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    reuse: ['work/heavy-priority-workflow-contracts-20260826-r132.md'],
    error: ['work/heavy-priority-error-recovery-contracts-20260826-r135.md'],
    performance: ['work/heavy-local-priority-performance-qa-20260826-r137.md'],
  }),
  'printing-image': local({
    generation: ['work/heavy-printing-priority-workflow-contracts-20260826-r134.md'],
    result: ['work/heavy-printing-priority-workflow-contracts-20260826-r134.md'],
    save: ['work/heavy-printing-priority-workflow-contracts-20260826-r134.md'],
    reuse: ['work/heavy-printing-priority-workflow-contracts-20260826-r134.md'],
    error: ['work/heavy-priority-error-recovery-contracts-20260826-r135.md'],
    performance: ['work/heavy-local-priority-performance-qa-20260826-r138.md'],
  }),
};

const records = validateParityBehaviorLedger(
  NON_VIDEO_PARITY_ROW_IDS.map((rowId) => {
    const layerOverrides = overrides[rowId] || {};
    const layers = Object.fromEntries(PARITY_BEHAVIOR_LAYERS.map((layer) => {
      if (includeHistoricalProduction && layerOverrides[layer]) return [layer, layerOverrides[layer]];
      if (layer === 'input') {
        return [layer, {
          status: 'verified-local',
          evidence: localInputEvidence,
          note: 'Heavy local input roles, library-or-upload mode, and shared workflow contract are verified by the 31-feature r209 readback; Lightchain live parity for this row remains separate.',
        }];
      }
      if (layer === 'screen') {
        return [layer, {
          status: 'verified-local',
          evidence: localScreenEvidence,
          note: 'Heavy local route/screen rendering is verified by the current 31-feature desktop/mobile workflow evidence; Lightchain live visual parity remains separate.',
        }];
      }
      if (localPriorityOverrides[rowId]?.[layer]) {
        return [layer, localPriorityOverrides[rowId][layer]];
      }
      const historicalCandidates = layerOverrides[layer]?.evidence ?? [];
      const note = historicalCandidates.length > 0
        ? `${pendingNote} Historical candidate evidence is retained only as a reference and is not promoted: ${historicalCandidates.join(', ')}`
        : pendingNote;
      return [layer, { status: 'PENDING_CONFIRMATION', evidence: [], note }];
    })) as ParityBehaviorLedgerRecord['layers'];
    return { rowId, layers };
  }),
);

const artifact = {
  schema: PARITY_BEHAVIOR_LEDGER_SCHEMA,
  generatedAt: new Date().toISOString(),
  scope: {
    sourceCandidateRows: 33,
    nonVideoRows: records.length,
    excludedVideoRows: ['video-workstation', 'video-detail'],
    layers: [...PARITY_BEHAVIOR_LAYERS],
  },
  evidenceBoundary: {
    sourceReadback,
    localHeavyContract: 'work/heavy-local-workflow-lifecycle-retry-readback-20260821-r209.md',
    localPriorityWorkflowEvidence: 'work/heavy-priority-workflow-contracts-20260826-r132.md',
    productionPromotion: includeHistoricalProduction
      ? 'explicit_historical_override_for_comparison_only'
      : 'disabled_until_current_same_run_lightchain_and_heavy_readback',
    statusMeaning: 'verified-production requires current same-run Lightchain and Heavy evidence; verified-local is not production parity; PENDING_CONFIRMATION and unknown are never promoted by this generator.',
  },
  records,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  rowCount: records.length,
  layerCount: PARITY_BEHAVIOR_LAYERS.length,
  pendingLayerCount: records.flatMap((record) => Object.values(record.layers)).filter((layer) => layer.status === 'PENDING_CONFIRMATION').length,
}, null, 2));

function productionLayer(evidence: string[], note: string) {
  return { status: 'verified-production' as const, evidence, note };
}

function production(layers: Partial<Record<ParityBehaviorLayer, string[]>>): LayerOverride {
  return Object.fromEntries(Object.entries(layers).map(([layer, evidence]) => [layer, productionLayer(evidence as string[], 'The cited same-run production artifact records this layer; it is not extended to other layers without evidence.')])) as LayerOverride;
}

function local(layers: Partial<Record<ParityBehaviorLayer, string[]>>): LayerOverride {
  return Object.fromEntries(Object.entries(layers).map(([layer, evidence]) => [layer, {
    status: 'verified-local' as const,
    evidence,
    note: 'The local priority workflow contract is verified by focused implementation tests; this does not promote production Lightchain/Heavy parity.',
  }])) as LayerOverride;
}

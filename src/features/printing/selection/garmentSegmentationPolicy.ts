export type GarmentSelectionSource = 'automatic' | 'tap' | 'range';

export type GarmentCutoutModel = 'silueta' | 'u2net_cloth_seg';

export type GarmentSegmentationTarget = 'upper' | 'lower' | 'full';

export const DEFAULT_GARMENT_SEGMENTATION_TARGET: GarmentSegmentationTarget = 'upper';

export const isGarmentMaskExplicitlyConfirmed = ({
  selectionSource,
  maskCandidateId,
  cutoutDone,
  hasProcessedMask,
  explicitlyConfirmed,
}: {
  selectionSource: GarmentSelectionSource;
  maskCandidateId: string;
  cutoutDone: boolean;
  hasProcessedMask: boolean;
  explicitlyConfirmed: boolean;
}) => (
  cutoutDone
  && hasProcessedMask
  && (
    maskCandidateId === 'manual'
    || (selectionSource !== 'automatic' && explicitlyConfirmed)
  )
);

export const canSubmitGarmentSelectionPreview = ({
  selectionSource,
  hasGuidedMask,
}: {
  selectionSource: Exclude<GarmentSelectionSource, 'automatic'> | null;
  hasGuidedMask: boolean;
}) => selectionSource === 'range' || (selectionSource === 'tap' && hasGuidedMask);

export const canExplicitlyConfirmProcessedGarmentMask = ({
  selectionSource,
  cutoutDone,
  hasProcessedMask,
}: {
  selectionSource: GarmentSelectionSource;
  cutoutDone: boolean;
  hasProcessedMask: boolean;
}) => (
  selectionSource !== 'automatic'
  && cutoutDone
  && hasProcessedMask
);

export const isCurrentGarmentMaskEditorTarget = ({
  capturedCandidateId,
  currentCandidateId,
  capturedMaskRevision,
  currentMaskRevision,
  capturedCutoutRequestId,
  currentCutoutRequestId,
}: {
  capturedCandidateId: string | undefined;
  currentCandidateId: string;
  capturedMaskRevision: number | undefined;
  currentMaskRevision: number;
  capturedCutoutRequestId: number | undefined;
  currentCutoutRequestId: number;
}) => (
  capturedCandidateId === currentCandidateId
  && capturedMaskRevision === currentMaskRevision
  && capturedCutoutRequestId === currentCutoutRequestId
);

export const normalizeGarmentSegmentationTarget = (
  value: unknown,
): GarmentSegmentationTarget => (
  value === 'lower' || value === 'full' || value === 'upper'
    ? value
    : DEFAULT_GARMENT_SEGMENTATION_TARGET
);

export const resolveGarmentSegmentationMaskIndex = (
  target: GarmentSegmentationTarget,
): 0 | 1 | 2 => ({
  upper: 0,
  lower: 1,
  full: 2,
}[normalizeGarmentSegmentationTarget(target)] as 0 | 1 | 2);

export type TransparentGarmentCutoutRoute = 'preserve-existing' | 'semantic-first';

export const GARMENT_SEMANTIC_SEGMENTATION_ENGINE = 'browser-ai-u2net_cloth_seg-v1' as const;

export const isGarmentSemanticSegmentationResult = ({
  selectionSource,
  resultEngine,
  requestedTarget,
  resultTarget,
}: {
  selectionSource: GarmentSelectionSource;
  resultEngine: string | null | undefined;
  requestedTarget: GarmentSegmentationTarget;
  resultTarget: GarmentSegmentationTarget | null | undefined;
}) => (
  selectionSource === 'tap'
  && resultEngine === GARMENT_SEMANTIC_SEGMENTATION_ENGINE
  && resultTarget === requestedTarget
);

/**
 * A tap is an intent signal, not proof that a cloth model is available.
 * Keep the general model as the deterministic fallback until a cloth model
 * has been explicitly deployed and configured for this build.
 */
export const resolveGarmentCutoutModel = ({
  selectionSource,
  clothModelConfigured,
}: {
  selectionSource: GarmentSelectionSource;
  clothModelConfigured: boolean;
}): GarmentCutoutModel => (
  selectionSource === 'tap' && clothModelConfigured
    ? 'u2net_cloth_seg'
    : 'silueta'
);

/**
 * A tap-confirmed preview is intentionally exported with transparency so the
 * downstream result cannot grow beyond the blue area the user approved. When
 * the optional cloth model is available, that transparency is a constraint,
 * not a reason to skip semantic inference altogether.
 */
export const resolveTransparentGarmentCutoutRoute = ({
  modelName,
  clothModelConfigured,
}: {
  modelName: GarmentCutoutModel;
  clothModelConfigured: boolean;
}): TransparentGarmentCutoutRoute => (
  modelName === 'u2net_cloth_seg' && clothModelConfigured
    ? 'semantic-first'
    : 'preserve-existing'
);

export const garmentSelectionModelStatus = ({
  selectionSource,
  clothModelConfigured,
  resultEngine,
  requestedTarget,
  resultTarget,
}: {
  selectionSource: GarmentSelectionSource;
  clothModelConfigured: boolean;
  resultEngine: string | null | undefined;
  requestedTarget: GarmentSegmentationTarget;
  resultTarget: GarmentSegmentationTarget | null | undefined;
}) => {
  const semantic = isGarmentSemanticSegmentationResult({
    selectionSource,
    resultEngine,
    requestedTarget,
    resultTarget,
  });
  if (selectionSource !== 'tap') {
    return {
      model: 'silueta' as const,
      semantic: false,
      message: '範囲指定は既存の高精度AI切り抜きと手動マスク修正で処理します。',
    };
  }
  if (semantic) {
    return {
      model: 'u2net_cloth_seg' as const,
      semantic: true,
      message: '衣服専用AIで服のカテゴリを認識し、切り抜きました。',
    };
  }
  if (clothModelConfigured) {
    return {
      model: 'silueta' as const,
      semantic: false,
      message: '衣服専用AIは完了せず、既存AI切り抜き結果を使用しています。必要なら手動マスクで調整してください。',
    };
  }
  return {
    model: 'silueta' as const,
    semantic: false,
    message: '衣服専用モデルが未配置のため、既存AI切り抜きと手動マスク修正へ安全に戻します。',
  };
};

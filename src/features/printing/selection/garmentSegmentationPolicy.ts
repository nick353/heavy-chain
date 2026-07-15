export type GarmentSelectionSource = 'automatic' | 'tap' | 'range';

export type GarmentCutoutModel = 'silueta' | 'u2net_cloth_seg';

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

export const garmentSelectionModelStatus = ({
  selectionSource,
  clothModelConfigured,
}: {
  selectionSource: GarmentSelectionSource;
  clothModelConfigured: boolean;
}) => {
  if (selectionSource !== 'tap') {
    return {
      model: 'silueta' as const,
      semantic: false,
      message: '範囲指定は既存の高精度AI切り抜きと手動マスク修正で処理します。',
    };
  }
  if (clothModelConfigured) {
    return {
      model: 'u2net_cloth_seg' as const,
      semantic: true,
      message: 'タップ位置を衣服専用モデルへ渡し、服のカテゴリを優先して切り抜きます。',
    };
  }
  return {
    model: 'silueta' as const,
    semantic: false,
    message: '衣服専用モデルが未配置のため、既存AI切り抜きと手動マスク修正へ安全に戻します。',
  };
};

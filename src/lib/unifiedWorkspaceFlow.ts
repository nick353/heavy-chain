export type UnifiedWorkspaceFlowState = 'draft' | 'ready' | 'generating' | 'completed' | 'failed';

export type UnifiedWorkspaceFlowSignals = {
  inputReady: boolean;
  rightsReady: boolean;
  generating: boolean;
  completed: boolean;
  failed: boolean;
  persisted?: boolean;
};

/**
 * The shared product state used by the apparel beta surfaces.
 * Provider calls and persistence remain owned by each feature; this function
 * only gives the shell and feature pages one deterministic state vocabulary.
 */
export function deriveUnifiedWorkspaceFlowState(
  signals: UnifiedWorkspaceFlowSignals,
): UnifiedWorkspaceFlowState {
  if (signals.generating) return 'generating';
  if (signals.failed) return 'failed';
  if (signals.completed || signals.persisted) return 'completed';
  if (signals.inputReady && signals.rightsReady) return 'ready';
  return 'draft';
}

export const unifiedWorkspaceFlowLabels: Record<UnifiedWorkspaceFlowState, string> = {
  draft: '下書き',
  ready: '生成準備完了',
  generating: '生成中',
  completed: '完了・再利用可能',
  failed: '失敗・再試行可能',
};

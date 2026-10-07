export type GenerationFlowStage = 'ready' | 'blocked' | 'generating' | 'complete' | 'failed';

export function deriveGenerationFlowStage(input: {
  isGenerating: boolean;
  hasError: boolean;
  hasResult: boolean;
  isDisabled: boolean;
}): GenerationFlowStage {
  if (input.isGenerating) return 'generating';
  if (input.hasError) return 'failed';
  if (input.hasResult) return 'complete';
  return input.isDisabled ? 'blocked' : 'ready';
}

export function getGenerationPrimaryActionLabel(input: {
  stage: GenerationFlowStage;
  isPromptOptimization: boolean;
  noImageGenerationMode: boolean;
}): string {
  if (input.stage === 'generating') return '生成中...';
  if (input.stage === 'failed') return '再試行';
  if (input.isPromptOptimization) return '最適化';
  return input.noImageGenerationMode ? '企画書を保存' : '生成する';
}

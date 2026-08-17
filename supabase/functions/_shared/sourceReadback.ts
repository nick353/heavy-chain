type SourceWorkspace = 'studio' | 'models' | 'patterns' | 'video' | 'lab' | 'marketing' | 'fitting';

type SourceConfig = {
  label: string;
  resumePaths: readonly string[];
  versions: readonly string[];
};

type SourceReadback = {
  sourceWorkspace: SourceWorkspace;
  workflowVersion: string;
  sourceLabel: string;
  sourceResumePath: string;
  sourceMode: 'local-workflow-intake';
};

const SOURCE_CONFIG: Record<SourceWorkspace, SourceConfig> = {
  studio: { label: 'Fashion Studio', resumePaths: ['/studio'], versions: ['studio-selection-local-v1'] },
  models: { label: 'モデルライブラリ', resumePaths: ['/models'], versions: ['model-library-local-v1'] },
  patterns: { label: '柄・グラフィック', resumePaths: ['/patterns', '/patterns/workbench'], versions: ['pattern-preview-local-v1'] },
  video: { label: 'Video Workstation', resumePaths: ['/video'], versions: ['video-storyboard-local-v1'] },
  lab: { label: 'Lab', resumePaths: ['/lab'], versions: ['lab-evaluation-local-v1'] },
  marketing: { label: 'マーケティングワークスペース', resumePaths: ['/marketing'], versions: ['marketing-brief-local-v1'] },
  fitting: { label: 'AIフィッティング', resumePaths: ['/fitting'], versions: ['fitting-brief-local-v1'] },
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const readString = (value: Record<string, unknown>, key: string, maxLength: number) => {
  const item = value[key];
  if (typeof item !== 'string') return null;
  const trimmed = item.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
};

export const sanitizeSourceReadback = (value: unknown): SourceReadback | null => {
  if (!isRecord(value)) return null;

  const sourceWorkspace = readString(value, 'sourceWorkspace', 40) as SourceWorkspace | null;
  if (!sourceWorkspace || !Object.hasOwn(SOURCE_CONFIG, sourceWorkspace)) return null;

  const config = SOURCE_CONFIG[sourceWorkspace];
  const workflowVersion = readString(value, 'workflowVersion', 120);
  const sourceLabel = readString(value, 'sourceLabel', 160);
  const sourceResumePath = readString(value, 'sourceResumePath', 160);
  const sourceMode = readString(value, 'sourceMode', 64);

  if (!workflowVersion || !config.versions.includes(workflowVersion)) return null;
  if (sourceLabel !== config.label) return null;
  if (!sourceResumePath || !config.resumePaths.includes(sourceResumePath)) return null;
  if (sourceMode !== 'local-workflow-intake') return null;

  return {
    sourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode: 'local-workflow-intake',
  };
};

const sanitizeGenerationIntent = (value: unknown, source: SourceReadback) => {
  if (!isRecord(value)) return null;
  const feature = readString(value, 'feature', 160);
  const prompt = readString(value, 'prompt', 8000);
  const href = readString(value, 'href', 8000);
  const label = readString(value, 'label', 240);
  if (!feature || !prompt || !href || !label) return null;
  if (readString(value, 'sourceWorkspace', 40) !== source.sourceWorkspace) return null;
  if (readString(value, 'workflowVersion', 120) !== source.workflowVersion) return null;
  if (readString(value, 'sourceLabel', 160) !== source.sourceLabel) return null;
  if (readString(value, 'sourceResumePath', 160) !== source.sourceResumePath) return null;
  if (readString(value, 'sourceMode', 64) !== source.sourceMode) return null;

  const aspectRatio = readString(value, 'aspectRatio', 40);
  return {
    feature,
    prompt,
    href,
    label,
    ...source,
    ...(aspectRatio ? { aspectRatio } : {}),
  };
};

export const buildSourceMetadata = (sourceReadback: unknown, generationIntent?: unknown) => {
  const source = sanitizeSourceReadback(sourceReadback);
  if (!source) return null;
  const intent = sanitizeGenerationIntent(generationIntent, source);
  return {
    ...source,
    ...(intent ? { generationIntent: intent } : {}),
  };
};

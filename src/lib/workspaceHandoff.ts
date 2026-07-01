import { saveWorkspaceArtifact } from './localWorkspaceArtifacts';
import { useCanvasStore } from '../stores/canvasStore';
import type { Json } from '../types/database';
import type { MaterialReferenceMetadata } from './workspaceMaterialReferences';

export type WorkspaceHandoffFeatureType =
  | 'fashion-studio'
  | 'model-library-workspace'
  | 'video-workstation'
  | 'lab-workflow'
  | 'graphic-pattern-workspace';
export type WorkspaceHandoffStatus = 'draft' | 'planned' | 'ready-for-generation';
export type WorkspaceHandoffKind = 'local-workflow-intake';

export interface GenerationIntent extends Record<string, Json | undefined> {
  feature: string;
  prompt: string;
  href: string;
  label: string;
  sourceWorkspace: 'studio' | 'video' | 'lab' | 'patterns' | 'models' | 'marketing';
  workflowVersion?: string;
  sourceLabel?: string;
  sourceResumePath?: string;
  sourceMode?: WorkspaceHandoffKind;
  aspectRatio?: string;
  bodyTypes?: string[];
  ageGroups?: string[];
  skinTone?: string;
  hairStyle?: string;
  modelCandidateLabel?: string;
  selectedPatternPreview?: PatternPreviewContext;
  motifPrompt?: string;
  repeatStyle?: string;
  garmentTarget?: string;
  paletteNotes?: string;
  vectorIntent?: string;
  referenceAssets?: string;
  materialReferences?: MaterialReferenceMetadata[];
  layerPlan?: Record<string, Json | undefined>;
  maskPlan?: Record<string, Json | undefined>;
  compositionPreview?: Record<string, Json | undefined>;
}

export type WorkspaceSource = GenerationIntent['sourceWorkspace'];

export interface PatternPreviewContext extends Record<string, string> {
  id: string;
  label: string;
  mode: string;
  repeatSignature: string;
  vectorSignature: string;
  paletteSignature: string;
}

export interface PatternGenerationContext {
  selectedPatternPreview: PatternPreviewContext;
  motifPrompt: string;
  repeatStyle: string;
  garmentTarget: string;
  paletteNotes: string;
  vectorIntent: string;
  referenceAssets: string;
}

export interface GenerationIntentSourceMetadata {
  sourceWorkspace: WorkspaceSource;
  workflowVersion: string;
  sourceLabel: string;
  sourceResumePath: string;
  sourceMode: WorkspaceHandoffKind;
}

export interface WorkspaceWorkflowMetadata {
  workflowVersion: string;
  inputs: Record<string, Json | undefined>;
  plan: Record<string, Json | undefined>;
  status: WorkspaceHandoffStatus;
  resumePath: string;
  handoffKind: WorkspaceHandoffKind;
  primaryInput: string;
  nextStep: string;
  generationIntent?: GenerationIntent;
}

export interface WorkspaceHandoffInput {
  brandId: string;
  featureType: WorkspaceHandoffFeatureType;
  projectName: string;
  title: string;
  prompt: string;
  imageUrl?: string;
  summary: string;
  note: string;
  activeChoice: string;
  progress: number;
  history: string[];
  workflow: WorkspaceWorkflowMetadata;
  previewMetadata?: Record<string, Json | undefined>;
  selectedStudioSetup?: Record<string, Json | undefined>;
  selectedModelCandidate?: Record<string, Json | undefined>;
  selectedVideoStoryboard?: Record<string, Json | undefined>;
  selectedLabExperiment?: Record<string, Json | undefined>;
  materialReferences?: MaterialReferenceMetadata[];
  layerPlan?: Record<string, Json | undefined>;
  maskPlan?: Record<string, Json | undefined>;
  compositionPreview?: Record<string, Json | undefined>;
  metadata?: Record<string, Json | undefined>;
}

const featureAccent: Record<WorkspaceHandoffFeatureType, string> = {
  'fashion-studio': '#22c55e',
  'model-library-workspace': '#14b8a6',
  'video-workstation': '#0ea5e9',
  'lab-workflow': '#f59e0b',
  'graphic-pattern-workspace': '#ec4899',
};

export const workspaceSourceConfig: Record<WorkspaceSource, { label: string; resumePath: string }> = {
  studio: { label: 'Fashion Studio', resumePath: '/studio' },
  models: { label: 'モデルライブラリ', resumePath: '/models' },
  patterns: { label: '柄・グラフィック', resumePath: '/patterns' },
  video: { label: 'Video Workstation', resumePath: '/video' },
  lab: { label: 'Lab', resumePath: '/lab' },
  marketing: { label: 'マーケティングワークスペース', resumePath: '/marketing' },
};

const workspaceAllowedWorkflowVersions: Record<WorkspaceSource, readonly string[]> = {
  studio: ['studio-selection-local-v1'],
  models: ['model-library-local-v1'],
  patterns: ['pattern-preview-local-v1'],
  video: ['video-storyboard-local-v1'],
  lab: ['lab-evaluation-local-v1'],
  marketing: ['marketing-brief-local-v1'],
};

const allowedSourceModes = new Set<WorkspaceHandoffKind>(['local-workflow-intake']);

const isWorkspaceSource = (value: string | null): value is WorkspaceSource => {
  return value === 'studio' || value === 'models' || value === 'patterns' || value === 'video' || value === 'lab' || value === 'marketing';
};

const isWorkspaceHandoffKind = (value: string | null): value is WorkspaceHandoffKind => {
  return value === 'local-workflow-intake';
};

export const buildGenerationIntentHref = ({
  feature,
  prompt,
  aspectRatio,
  sourceWorkspace,
  workflowVersion,
  sourceLabel,
  sourceResumePath,
  sourceMode,
  bodyTypes,
  ageGroups,
  skinTone,
  hairStyle,
  modelCandidateLabel,
  patternContext,
}: {
  feature: string;
  prompt: string;
  aspectRatio?: string;
  bodyTypes?: readonly string[];
  ageGroups?: readonly string[];
  skinTone?: string;
  hairStyle?: string;
  modelCandidateLabel?: string;
  patternContext?: PatternGenerationContext;
} & GenerationIntentSourceMetadata) => {
  const params = new URLSearchParams({
    feature,
    prompt,
    sourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode,
  });
  if (aspectRatio) params.set('ratio', aspectRatio);
  if (bodyTypes?.length) params.set('bodyTypes', bodyTypes.join(','));
  if (ageGroups?.length) params.set('ageGroups', ageGroups.join(','));
  if (skinTone) params.set('skinTone', skinTone);
  if (hairStyle) params.set('hairStyle', hairStyle);
  if (modelCandidateLabel) params.set('modelCandidateLabel', modelCandidateLabel);
  if (patternContext) {
    params.set('patternPreviewId', patternContext.selectedPatternPreview.id);
    params.set('patternPreviewLabel', patternContext.selectedPatternPreview.label);
    params.set('patternPreviewMode', patternContext.selectedPatternPreview.mode);
    params.set('repeatSignature', patternContext.selectedPatternPreview.repeatSignature);
    params.set('vectorSignature', patternContext.selectedPatternPreview.vectorSignature);
    params.set('paletteSignature', patternContext.selectedPatternPreview.paletteSignature);
    params.set('motifPrompt', patternContext.motifPrompt);
    params.set('repeatStyle', patternContext.repeatStyle);
    params.set('garmentTarget', patternContext.garmentTarget);
    params.set('paletteNotes', patternContext.paletteNotes);
    params.set('vectorIntent', patternContext.vectorIntent);
    params.set('referenceAssets', patternContext.referenceAssets);
  }
  return `/generate?${params.toString()}`;
};

export const hydrateGenerationIntentSource = (params: URLSearchParams): GenerationIntentSourceMetadata | null => {
  const sourceWorkspace = params.get('sourceWorkspace');
  if (!isWorkspaceSource(sourceWorkspace)) return null;

  const config = workspaceSourceConfig[sourceWorkspace];
  const sourceResumePath = params.get('sourceResumePath');
  const workflowVersion = params.get('workflowVersion');
  const sourceMode = params.get('sourceMode');
  const sourceLabel = params.get('sourceLabel');

  if (sourceResumePath !== config.resumePath) return null;
  if (sourceLabel !== config.label) return null;
  if (!workflowVersion || !workspaceAllowedWorkflowVersions[sourceWorkspace].includes(workflowVersion)) return null;
  if (!isWorkspaceHandoffKind(sourceMode) || !allowedSourceModes.has(sourceMode)) return null;

  return {
    sourceWorkspace,
    workflowVersion,
    sourceLabel,
    sourceResumePath,
    sourceMode,
  };
};

const readRequiredParam = (params: URLSearchParams, key: string) => {
  const value = params.get(key);
  return value && value.trim() ? value : null;
};

const readOptionalParam = (params: URLSearchParams, key: string) => {
  return params.get(key) ?? '';
};

export const hydratePatternGenerationContext = (params: URLSearchParams): PatternGenerationContext | null => {
  const selectedPatternPreview = {
    id: readRequiredParam(params, 'patternPreviewId'),
    label: readRequiredParam(params, 'patternPreviewLabel'),
    mode: readRequiredParam(params, 'patternPreviewMode'),
    repeatSignature: readRequiredParam(params, 'repeatSignature'),
    vectorSignature: readRequiredParam(params, 'vectorSignature'),
    paletteSignature: readRequiredParam(params, 'paletteSignature'),
  };
  const motifPrompt = readRequiredParam(params, 'motifPrompt');
  const repeatStyle = readRequiredParam(params, 'repeatStyle');
  const garmentTarget = readRequiredParam(params, 'garmentTarget');
  const paletteNotes = readRequiredParam(params, 'paletteNotes');
  const vectorIntent = readRequiredParam(params, 'vectorIntent');
  const referenceAssets = readOptionalParam(params, 'referenceAssets');

  if (
    !selectedPatternPreview.id ||
    !selectedPatternPreview.label ||
    !selectedPatternPreview.mode ||
    !selectedPatternPreview.repeatSignature ||
    !selectedPatternPreview.vectorSignature ||
    !selectedPatternPreview.paletteSignature ||
    !motifPrompt ||
    !repeatStyle ||
    !garmentTarget ||
    !paletteNotes ||
    !vectorIntent
  ) {
    return null;
  }

  return {
    selectedPatternPreview: {
      id: selectedPatternPreview.id,
      label: selectedPatternPreview.label,
      mode: selectedPatternPreview.mode,
      repeatSignature: selectedPatternPreview.repeatSignature,
      vectorSignature: selectedPatternPreview.vectorSignature,
      paletteSignature: selectedPatternPreview.paletteSignature,
    },
    motifPrompt,
    repeatStyle,
    garmentTarget,
    paletteNotes,
    vectorIntent,
    referenceAssets,
  };
};

const encodeSvg = (svg: string) => {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const escapeSvgText = (value: string) => {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
};

const buildPreviewImage = (input: WorkspaceHandoffInput) => {
  const accent = featureAccent[input.featureType];
  const safeTitle = escapeSvgText(input.title.slice(0, 48));
  const safeChoice = escapeSvgText(input.activeChoice);
  const safeSummary = escapeSvgText(input.summary.slice(0, 64));
  const safeNote = escapeSvgText(input.note.slice(0, 80));
  const safePrimaryInput = escapeSvgText(input.workflow.primaryInput.slice(0, 74));
  const safeNextStep = escapeSvgText(input.workflow.nextStep.slice(0, 74));
  return encodeSvg(`
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
      <rect width="960" height="640" rx="36" fill="#fafafa"/>
      <rect x="56" y="56" width="848" height="528" rx="28" fill="#ffffff" stroke="#e5e5e5"/>
      <rect x="96" y="112" width="${Math.max(120, Math.min(700, input.progress * 7))}" height="18" rx="9" fill="${accent}"/>
      <text x="96" y="198" font-family="Inter, Arial, sans-serif" font-size="44" font-weight="700" fill="#171717">${safeTitle}</text>
      <text x="96" y="260" font-family="Inter, Arial, sans-serif" font-size="24" fill="#525252">${safeChoice} / ${input.progress}%</text>
      <text x="96" y="322" font-family="Inter, Arial, sans-serif" font-size="24" fill="#404040">${safeSummary}</text>
      <text x="96" y="386" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" fill="#262626">Primary input</text>
      <text x="96" y="426" font-family="Inter, Arial, sans-serif" font-size="20" fill="#525252">${safePrimaryInput}</text>
      <text x="96" y="486" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="700" fill="#262626">Next step</text>
      <text x="96" y="526" font-family="Inter, Arial, sans-serif" font-size="20" fill="#525252">${safeNextStep}</text>
      <text x="96" y="560" font-family="Inter, Arial, sans-serif" font-size="16" fill="#737373">${safeNote}</text>
    </svg>
  `);
};

export const handoffWorkspaceToCanvas = (input: WorkspaceHandoffInput) => {
  const canvasStore = useCanvasStore.getState();
  const projectId = canvasStore.createProject(input.projectName, input.brandId);
  const imageUrl = input.imageUrl ?? buildPreviewImage(input);
  const createdAt = new Date().toISOString();

  const artifact = saveWorkspaceArtifact({
    brandId: input.brandId,
    featureType: input.featureType,
    title: input.title,
    imageUrl,
    prompt: input.prompt,
    canvasProjectId: projectId,
    createdAt,
    metadata: {
      feature: input.featureType,
      activeChoice: input.activeChoice,
      progress: input.progress,
      note: input.note,
      summary: input.summary,
      history: input.history,
      workflowVersion: input.workflow.workflowVersion,
      inputs: input.workflow.inputs,
      plan: input.workflow.plan,
      status: input.workflow.status,
      resumePath: input.workflow.resumePath,
      handoffKind: input.workflow.handoffKind,
      primaryInput: input.workflow.primaryInput,
      nextStep: input.workflow.nextStep,
      generationIntent: input.workflow.generationIntent,
      preview: input.previewMetadata,
      selectedStudioSetup: input.selectedStudioSetup,
      selectedModelCandidate: input.selectedModelCandidate,
      selectedVideoStoryboard: input.selectedVideoStoryboard,
      selectedLabExperiment: input.selectedLabExperiment,
      materialReferences: input.materialReferences,
      layerPlan: input.layerPlan,
      maskPlan: input.maskPlan,
      compositionPreview: input.compositionPreview,
      ...input.metadata,
    },
  });

  canvasStore.addObject({
    type: 'image',
    x: 96,
    y: 96,
    width: 420,
    height: 280,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    locked: false,
    visible: true,
    src: imageUrl,
    label: input.title,
    metadata: {
      feature: input.featureType,
      prompt: input.prompt,
      generation: 0,
      parameters: {
        source: 'workspace-handoff',
        sourceArtifactId: artifact.id,
        activeChoice: input.activeChoice,
        progress: input.progress,
        workflowVersion: input.workflow.workflowVersion,
        handoffKind: input.workflow.handoffKind,
        resumePath: input.workflow.resumePath,
        generationIntent: input.workflow.generationIntent,
        preview: input.previewMetadata,
        selectedStudioSetup: input.selectedStudioSetup,
        selectedModelCandidate: input.selectedModelCandidate,
        selectedVideoStoryboard: input.selectedVideoStoryboard,
        selectedLabExperiment: input.selectedLabExperiment,
        materialReferences: input.materialReferences,
        layerPlan: input.layerPlan,
        maskPlan: input.maskPlan,
        compositionPreview: input.compositionPreview,
      },
    },
  });

  canvasStore.addObject({
    type: 'text',
    x: 560,
    y: 112,
    width: 360,
    height: 240,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    locked: false,
    visible: true,
    text: `${input.summary}\n\nPrimary input: ${input.workflow.primaryInput}\nNext step: ${input.workflow.nextStep}\n\n${input.note}`,
    fontSize: 24,
    fontFamily: 'Noto Sans JP',
    fill: '#262626',
    label: `${input.title} メモ`,
    metadata: {
      feature: input.featureType,
      prompt: input.prompt,
      generation: 0,
      parameters: {
        source: 'workspace-handoff-note',
        sourceArtifactId: artifact.id,
        primaryInput: input.workflow.primaryInput,
        nextStep: input.workflow.nextStep,
        status: input.workflow.status,
        generationIntent: input.workflow.generationIntent,
        materialReferences: input.materialReferences,
        layerPlan: input.layerPlan,
        maskPlan: input.maskPlan,
        compositionPreview: input.compositionPreview,
      },
    },
  });

  canvasStore.saveCurrentProject();

  return { artifact, projectId };
};

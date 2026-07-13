import type { Feature } from '../components/FeatureSelector';
import { SAFETY_PROMPT_APPENDIX } from './legalSafetyGuard';

const FEATURE_QUALITY_GUIDANCE: Record<string, string[]> = {
  'campaign-image': [
    'premium apparel campaign visual',
    'clear product focus',
    'balanced advertising composition',
    'leave clean negative space for copy',
  ],
  'product-shots': [
    'premium ecommerce product photography',
    'centered full product view',
    'accurate garment shape and fabric texture',
    'catalog-ready lighting',
  ],
  'model-matrix': [
    'realistic ecommerce fitting image',
    'natural model pose',
    'accurate garment fit',
    'clean editorial lighting',
  ],
  'design-gacha': [
    'apparel design concept board or finished single concept',
    'production-ready garment idea with clear silhouette and material details',
    'use abstract chain or pattern graphics when the user asks for chain/pattern direction',
    'no alphabet letters, monograms, logo-like emblems, or fake brand marks',
    'brandable streetwear direction without readable marks',
  ],
  'multilingual-banner': [
    'finished ecommerce banner composition, not a plain model portrait',
    'large readable headline and supporting copy integrated into the layout',
    'clear typography hierarchy with enough contrast and spacing',
    'product remains visible while leaving a dedicated text area',
    'international storefront ready promotional banner',
  ],
  'scene-coordinate': [
    'realistic lifestyle product scene',
    'product remains recognizable',
    'chain motif and garment front remain visible',
    'natural environment lighting',
    'commercial fashion styling',
  ],
  colorize: [
    'realistic color variation',
    'preserve original garment structure',
    'accurate material texture',
  ],
  'remove-bg': [
    'clean product cutout',
    'preserve garment edges',
    'catalog-ready transparent-background-ready isolation',
    'natural apparel silhouette without display forms',
  ],
  upscale: [
    'high resolution product image',
    'preserve details without artifacts',
    'sharp but natural fabric texture',
  ],
  variations: [
    'controlled apparel campaign variation',
    'preserve product identity',
    'natural garment shape without mannequin or neck form',
    'single finished commerce image, not a grid or collage',
    'commercially usable styling with realistic fabric',
  ],
};

const DEFAULT_QUALITY_GUIDANCE = [
  'premium apparel visual',
  'commercially usable output',
  'realistic fabric texture',
  'clean composition',
];

const GLOBAL_NEGATIVE_TERMS = [
  'no test text',
  'no verification labels',
  'no watermark',
  'no random logo',
  'no misspelled text',
  'no broken typography',
  'no distorted garment',
  'no mannequin',
  'no neck form',
  'no ghost mannequin',
  'no plastic display form',
  'no headless torso',
  'no floating collar',
  'no distorted neckline',
  'no extra limbs',
  'no deformed hands',
  'no low-resolution artifacts',
  'no blurry product details',
];

const normalizeLine = (value: string | null | undefined) =>
  value?.replace(/\s+/g, ' ').trim() ?? '';

export interface ProductionPromptInput {
  feature: Pick<Feature, 'id' | 'name'> | null;
  userBrief: string;
  styleLabel?: string | null;
  aspectRatio?: string;
  textOverlay?: Record<string, unknown> | null;
  referenceImagePresent?: boolean;
  extraLines?: Array<string | null | undefined>;
}

export const buildProductionImagePrompt = ({
  feature,
  userBrief,
  styleLabel,
  aspectRatio,
  textOverlay,
  referenceImagePresent,
  extraLines = [],
}: ProductionPromptInput) => {
  const featureName = feature?.name ?? 'Apparel image';
  const guidance = feature ? FEATURE_QUALITY_GUIDANCE[feature.id] : null;
  const qualityLines = guidance?.length ? guidance : DEFAULT_QUALITY_GUIDANCE;
  const lines = [
    `Task: ${featureName}`,
    normalizeLine(userBrief) ? `User brief: ${normalizeLine(userBrief)}` : '',
    styleLabel ? `Style direction: ${styleLabel}` : '',
    aspectRatio ? `Aspect ratio: ${aspectRatio}` : '',
    referenceImagePresent ? 'Use the supplied reference image as the product/style source.' : '',
    ...extraLines.map(normalizeLine),
    `Quality bar: ${qualityLines.join(', ')}`,
    textOverlay
      ? `Text overlay must use only the requested copy and remain legible: ${JSON.stringify(textOverlay)}`
      : feature?.id === 'multilingual-banner'
        ? 'If headline or subheadline copy is supplied in the prompt, include it as readable banner typography. Do not invent extra words, fake brand names, random letters, or watermarks.'
        : 'Do not add any visible text, letters, captions, logo marks, approval notes, or watermarks unless explicitly requested.',
    SAFETY_PROMPT_APPENDIX,
    'Output must look like a finished apparel commerce asset, not a mock test image.',
  ].filter(Boolean);

  return lines.join('\n');
};

export const mergeProductionNegativePrompt = (negativePrompt: string) => {
  const userTerms = negativePrompt
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set([...userTerms, ...GLOBAL_NEGATIVE_TERMS])).join(', ');
};

export type LightchainProviderRoute = 'edit-image' | 'model-matrix' | 'generate-image' | 'unsupported';

const MODEL_MATRIX_TOOL_IDS = new Set([
  'ai-fitting',
  'ai-fitting-reference',
  'model-library',
  'model-face',
  'model-change',
  'body-shape',
  'clothing-size',
  'pose-change',
  'background-change',
  'angle-change',
  'model-custom',
]);

const EDIT_IMAGE_TOOL_IDS = new Set([
  'marketing-home',
  'marketing-detail',
  'fitting-clothing-reference',
  'fitting-background-reference',
  'wear-design-lab',
  'wear-design-detail',
  'fashion-studio',
  'design-agent',
  'print-design-project',
  'print-design-detail',
  'fabric-image',
  'printing-image',
  'line-generation',
  'line-to-real',
  'pattern-vector',
  'pattern-vector-pro',
  'image-repair',
  'svg-convert',
  'custom-style',
  'lab',
]);

const TEXT_GENERATION_TOOL_IDS = new Set([
  'video-workstation',
  'video-detail',
]);

export function getLightchainProviderRoute(toolId: string): LightchainProviderRoute {
  if (MODEL_MATRIX_TOOL_IDS.has(toolId)) return 'model-matrix';
  if (EDIT_IMAGE_TOOL_IDS.has(toolId)) return 'edit-image';
  if (TEXT_GENERATION_TOOL_IDS.has(toolId)) return 'unsupported';
  // A new catalog row must be admitted explicitly with a provider contract.
  // Falling through to generic image generation would silently change the
  // input schema and make an unverified feature look supported.
  return 'unsupported';
}

export function isLightchainProviderSupported(toolId: string) {
  return getLightchainProviderRoute(toolId) !== 'unsupported';
}

type PromptInput = {
  toolId: string;
  toolTitle: string;
  summary: string;
  primaryName?: string | null;
  secondaryName?: string | null;
  brief?: string | null;
  referenceNote?: string | null;
  briefOnly?: boolean;
};

const truncate = (value: string | null | undefined, maxLength: number) => (
  String(value || '').trim().slice(0, maxLength)
);

export function buildLightchainProviderPrompt(input: PromptInput) {
  const summary = truncate(input.summary, 1200);
  const brief = truncate(input.brief, 800);
  const referenceNote = truncate(input.referenceNote, 800);
  const primary = input.briefOnly
    ? 'no required source image (brief-only workflow)'
    : truncate(input.primaryName, 160) || 'the first reference image';
  const secondary = input.briefOnly
    ? 'optional references only'
    : truncate(input.secondaryName, 160) || 'the second reference image';
  const isModelMatrixRoute = MODEL_MATRIX_TOOL_IDS.has(input.toolId);
  const inputGuardrail = input.briefOnly && isModelMatrixRoute
    ? 'This is an explicit brief-only model-matrix workflow. Build the requested model result from the workflow brief and settings; optional references are context only. Do not claim that source pixels, identity, silhouette, or framing were preserved when no authoritative source image was supplied. This is a model-matrix operation, not a garment-mask edit. Use any optional references only for the model attribute named in the workflow summary. Do not silently convert the request into a generic garment redesign. Do not invent text, logos, trademarks, protected identities, or unrelated objects.'
    : input.briefOnly
      ? 'This is an explicit brief-only workflow. Build the requested result from the workflow brief and settings; optional references are context only. Do not claim that source pixels, identity, silhouette, or framing were preserved when no authoritative source image was supplied. Do not invent text, logos, trademarks, protected identities, or unrelated objects.'
      : isModelMatrixRoute
    ? 'This is a model-matrix operation, not a garment-mask edit. Use any primary and secondary references only for the model attribute named in the workflow summary. Preserve every unrequested garment, construction detail, pose, framing, lighting, and background detail. Do not silently convert the request into a generic new-person or garment redesign.'
    : 'Use the first uploaded reference as the authoritative full-frame source image and the later references only as material/artwork references. This is a masked in-place edit, not a new subject generation: keep the exact same person, face, hair, body proportions, camera framing, pose, garment silhouette, and background. Only pixels inside the transparent editable garment mask may change; treat every opaque mask pixel as locked and reproduce it from the first image. Never crop, reframe, relight, replace, or redraw the person. Preserve identity, silhouette, construction, colors, proportions, seams, hardware, texture direction, and lighting whenever they are not explicitly changed.';
  const shared = [
    `LIGHTCHAIN ROUTE: ${input.toolId} (${truncate(input.toolTitle, 120)})`,
    `PRIMARY INPUT: ${primary}`,
    `SECONDARY INPUT: ${secondary}`,
    `WORKFLOW SUMMARY: ${summary}`,
    brief ? `USER BRIEF: ${brief}` : null,
    referenceNote ? `REFERENCE NOTE: ${referenceNote}` : null,
    inputGuardrail,
    'Do not invent text, logos, trademarks, protected identities, or unrelated objects. Return a clean production-ready image with no UI, labels, borders, or watermark.',
  ].filter(Boolean).join('\n');

  const taskInstruction = input.briefOnly && !isModelMatrixRoute
    ? `Create a polished ${truncate(input.toolTitle, 120)} result from the workflow brief and selected settings. If optional references are present, use them as inspiration or context only; return a coherent production-ready image without claiming pixel-preserving editing.`
    : (() => {
    switch (input.toolId) {
      case 'fabric-image':
        return `Apply the textile material and weave/texture characteristics from ${secondary} to the garment/design in ${primary}. Keep the garment silhouette and construction exactly stable. Preserve seams, folds, cuffs, hardware, and the original color relationship while making the fabric read naturally at close range.`;
      case 'printing-image':
        return `Apply the print artwork from ${secondary} to the garment in ${primary}. Respect the requested placement, scale, mode, and transform described in the workflow summary. Keep the garment shape, folds, seams, lighting, and material stable; warp the print naturally to the garment surface without inventing extra marks.`;
      case 'line-generation':
        return `Create a precise fashion line drawing from ${primary}. Preserve every garment construction line and distinctive detail, using the requested color or monochrome treatment. Keep the output clean, complete, and suitable for production review.`;
      case 'line-to-real':
        return `Transform the line-art/design reference in ${primary} into a realistic fashion product image. Preserve the exact design, proportions, construction, and requested material direction; add believable light and folds without changing the design.`;
      case 'pattern-vector':
      case 'pattern-vector-pro':
        return `Convert the pattern/design in ${primary} into a clean, repeatable vector-style graphic while preserving motif geometry, spacing, palette, and layer intent. Do not simplify away distinctive details or add a logo.`;
      case 'svg-convert':
        return `Convert the subject in ${primary} into a clean vector-style asset. Preserve the outline, internal construction, palette, and negative space, with crisp edges and no extra text.`;
      case 'image-repair':
        return `Repair only the ${summary}. Preserve the original subject, garment, face/identity, pose intent, composition, and texture. Correct the visible deformation or selected region naturally and do not redesign the image.`;
      case 'marketing-home':
        return `Create a polished marketing composition from ${primary}. Use the selected channel, layout, copy, and call-to-action constraints in the workflow summary. Keep the product appearance, proportions, and brand treatment faithful while building the requested promotional scene.`;
      case 'marketing-detail':
        return `Create the requested exhibition, store, or brand visual from ${primary}. Apply only the selected layers and use-case preset in the workflow summary; keep the product, framing, and brand treatment coherent and production-ready.`;
      case 'fitting-clothing-reference':
        return `Prepare ${primary} as a clean clothing reference for AI fitting. Preserve the garment shape, construction, colors, and distinctive details; do not remove required information or introduce a second garment.`;
      case 'fitting-background-reference':
        return `Prepare ${primary} as a clean background reference for AI fitting. Preserve scene geometry, perspective, lighting cues, and spatial relationships; do not invent a model or garment.`;
      case 'ai-fitting':
      case 'ai-fitting-reference':
        return `Create a natural model-wearing result from the garment in ${primary}. Keep the garment's silhouette, construction, print, and proportions faithful. Use the supplied model, pose, and background references only as requested, and do not introduce a second garment or unrelated subject.`;
      case 'model-face':
        return `Change only the model's face using ${secondary}. Preserve the original garment, body proportions, pose, camera framing, hair direction, lighting, and background. The face reference may change facial appearance, but no other subject attribute may drift.`;
      case 'model-change':
        return `Replace only the main model using ${secondary}. Preserve the garment design, size relationship, pose intent, camera framing, lighting, and background. Keep the requested clothing-size relationship stable and do not redesign the product.`;
      case 'body-shape':
        return `Change only the model body shape specified in the workflow summary. Preserve the face, identity, garment design and construction, pose intent, camera framing, lighting, and background.`;
      case 'clothing-size':
        return `Change only the clothing size specified in the workflow summary. Preserve the model identity, body proportions, face, pose, camera framing, lighting, garment design, and construction; adjust fit and drape without inventing a new garment.`;
      case 'pose-change':
        return `Change only the model pose using ${secondary} or the requested custom pose. Preserve the model identity, face, garment design and construction, camera intent, lighting, and background.`;
      case 'background-change':
        return `Change only the background using ${secondary} or the requested scene description. Preserve the model identity, face, garment, pose, camera framing, lighting relationship, and product scale.`;
      case 'angle-change':
        return `Change only the camera angle and composition specified in the workflow summary. Preserve the model identity, garment design and construction, pose intent, lighting, and background relationship; keep the requested garment features visible.`;
      case 'model-custom':
        return `Generate a dedicated virtual fashion model using the gender, age, nationality, skin tone, and body conditions in the workflow summary. Keep the result suitable for apparel ecommerce and do not add logos, text, or unrelated props.`;
      case 'model-library':
        return `Generate apparel-ready model candidates using the model conditions in the workflow summary. Keep each candidate clean, consistent, and suitable for ecommerce comparison without adding logos, text, or unrelated props.`;
      case 'fashion-studio':
        return `Create the requested fashion-studio scene using ${primary} as the authoritative product/subject reference. Preserve the product exactly while changing only the requested model, scene, or styling direction.`;
      case 'wear-design-detail':
      case 'wear-design-lab':
        return `Apply the requested garment detail change to ${primary}. Preserve all unrequested construction and material details, and make the changed detail physically plausible and production-readable.`;
      case 'print-design-detail':
      case 'print-design-project':
        return `Develop the requested print/design direction from ${primary}. Preserve the source motif and garment relationship, and return a polished production-facing design image.`;
      case 'design-agent':
        return `Create a polished design-planning visual from the brand, collection, and item brief. Use ${primary} as context when supplied, preserve the requested design direction, and return a coherent series concept without inventing unrelated products.`;
      case 'lab':
        return `Run the requested Heavy Chain Lab transformation from ${primary}. Preserve the source subject and make the requested conversion, quality check, and adoption signal clear in a production-ready result.`;
      case 'custom-style':
        return `Create a coherent custom-style reference board/image based on the supplied source material and workflow summary. Keep the source subject recognizable and consistent across the result.`;
      default:
        return `Create the requested ${truncate(input.toolTitle, 120)} result using the supplied references and workflow summary. Make only the requested change and preserve the source subject faithfully.`;
    }
      })();

  return `${taskInstruction}\n\n${shared}`.trim();
}

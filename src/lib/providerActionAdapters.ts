// Restores the multi-image provider actions on the Cloudflare data plane by
// composing what already exists there: Claude writes one prompt per output
// (`image-plan`), and each prompt runs through the durable `generate-image` /
// `edit-image` actions. Background removal and upscaling run in the browser.
// Every action returns the response shape the generate/canvas pages read.

type Body = Record<string, unknown>;
export type PlanItem = { key: string; label: string; prompt: string; headline: string; subheadline: string };
type ReceiptImage = { imageUrl: string; storagePath: string; imageId?: string; jobId?: string };
type Receipt = { images?: ReceiptImage[]; jobId?: string | null };

export type CompositeDeps = {
  /** Durable Cloudflare image action (generate-image / edit-image). */
  image(action: 'generate-image' | 'edit-image', body: Body): Promise<Receipt>;
  /** Claude `image-plan` text action. */
  plan(body: Body): Promise<{ items?: PlanItem[] }>;
  /** Small data URL of a reference image for Claude vision, or null. */
  toDataUrl(imageUrl: string): Promise<string | null>;
  cutout(imageUrl: string): Promise<string>;
  upscale(imageUrl: string, options: { scale: number; sharpness: number; denoiseLevel: number }): Promise<string>;
};

export const COMPOSITE_PROVIDER_ACTIONS = new Set([
  'multilingual-banner', 'design-gacha', 'product-shots', 'generate-variations', 'colorize', 'remove-background', 'upscale',
]);

const PASS_THROUGH = ['brandId', 'legalSafety', 'generationProvider', 'generationModel', 'lightchainCompat', 'sourceReadback',
  'materialReference', 'materialReferences', 'style', 'negativePrompt', 'parentImageId'] as const;
const ASPECT_RATIOS = new Set(['1:1', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '2:3', '3:2']);
const LANGUAGE_NAMES: Record<string, string> = { ja: '日本語', en: '英語', zh: '中国語', ko: '韓国語', fr: 'フランス語', es: 'スペイン語', de: 'ドイツ語', th: 'タイ語' };
const MAX_OUTPUTS = 8;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []);
const referenceOf = (body: Body) => text(body.imageUrl) || text(body.referenceImage);

function baseImageBody(body: Body, featureType: string): Body {
  const next: Body = { featureType };
  for (const key of PASS_THROUGH) if (body[key] !== undefined) next[key] = body[key];
  return next;
}

const FALLBACK_GUIDE: Record<string, string> = {
  banner: 'Clean apparel marketing banner with the headline rendered clearly.',
  'design-gacha': 'Apparel product design concept.',
  'product-shots': 'Professional e-commerce product photo of the same garment, shot:',
  variations: 'Create a variation of the garment while keeping it recognizable.',
  scene: 'Place the same garment in this scene with matching lighting:',
  colorize: 'Recolor only the garment, keeping shape and texture, to:',
};

/** Claude plan, or a plain template when Claude is unavailable so the feature still runs. */
async function planOrTemplate(deps: CompositeDeps, request: Body, keys: string[], count: number): Promise<PlanItem[]> {
  try {
    const items = (await deps.plan(request)).items ?? [];
    if (items.length) return items.slice(0, count);
  } catch (error) {
    console.warn('image-plan unavailable, using template prompts:', error);
  }
  const task = String(request.task);
  const brief = text(request.brief);
  return Array.from({ length: count }, (_, index) => {
    const key = keys[index] ?? String(index + 1);
    return { key, label: keys[index] ?? `${index + 1}`, prompt: [FALLBACK_GUIDE[task], keys[index], brief].filter(Boolean).join(' '),
      headline: text(request.headline), subheadline: text(request.subheadline) };
  });
}

/** Runs one image request per prompt, sequentially (one running request per user). */
async function runEach<T>(items: PlanItem[], run: (item: PlanItem) => Promise<T | null>): Promise<T[]> {
  const results: T[] = []; let firstError: unknown = null;
  for (const item of items) {
    try { const value = await run(item); if (value) results.push(value); }
    catch (error) { firstError ??= error; }
  }
  if (!results.length) throw firstError ?? new Error('image_generation_failed');
  return results;
}

const firstImage = (receipt: Receipt) => {
  const image = receipt.images?.[0];
  if (!image?.imageUrl) throw new Error('image_receipt_missing_image');
  return image;
};

async function visionReference(deps: CompositeDeps, reference: string) {
  if (!reference) return undefined;
  try { return (await deps.toDataUrl(reference)) ?? undefined; } catch { return undefined; }
}

async function imageFor(deps: CompositeDeps, body: Body, featureType: string, prompt: string, reference: string, extra: Body = {}) {
  const request = { ...baseImageBody(body, featureType), ...extra, prompt, count: 1 };
  return firstImage(reference
    ? await deps.image('edit-image', { ...request, imageUrl: reference })
    : await deps.image('generate-image', request));
}

export async function runCompositeProviderAction(action: string, body: Body, deps: CompositeDeps): Promise<Body> {
  const reference = referenceOf(body);
  switch (action) {
    case 'multilingual-banner': {
      const languages = (strings(body.languages).length ? strings(body.languages) : ['ja', 'en', 'zh', 'ko']).slice(0, MAX_OUTPUTS);
      const headline = text(body.headline); if (!headline) throw new Error('headline_required');
      const items = await planOrTemplate(deps, { brandId: body.brandId, task: 'banner', items: languages, headline,
        subheadline: text(body.subheadline), imageDataUrl: await visionReference(deps, reference) }, languages, languages.length);
      const aspectRatio = ASPECT_RATIOS.has(text(body.aspectRatio)) ? text(body.aspectRatio) : undefined;
      const banners = await runEach(items, async item => {
        const copy = [item.headline || headline, item.subheadline].filter(Boolean).join('\n');
        const image = await imageFor(deps, body, 'multilingual-banner', item.prompt, reference, { aspectRatio, textOverlay: { text: copy } });
        return { ...image, language: item.key, languageName: LANGUAGE_NAMES[item.key] ?? item.label,
          headline: item.headline || headline, subheadline: item.subheadline };
      });
      return { success: true, banners };
    }
    case 'design-gacha': {
      const count = Math.min(MAX_OUTPUTS, Math.max(1, Number(body.directions) || 4));
      const items = await planOrTemplate(deps, { brandId: body.brandId, task: 'design-gacha', count, brief: text(body.brief),
        fixedElements: strings(body.fixedElements), randomizedElements: strings(body.randomizedElements),
        imageDataUrl: await visionReference(deps, reference) }, [], count);
      const variations = await runEach(items, async item => {
        const image = await imageFor(deps, body, 'design-gacha', item.prompt, reference);
        return { ...image, prompt: item.prompt, directionName: item.label };
      });
      return { success: true, variations, jobId: variations[0]?.jobId ?? null };
    }
    case 'product-shots': {
      const shots = (strings(body.shots).length ? strings(body.shots) : ['front', 'side', 'back', 'detail']).slice(0, MAX_OUTPUTS);
      const description = text(body.productDescription);
      if (!description && !reference) throw new Error('product_description_or_image_required');
      const items = await planOrTemplate(deps, { brandId: body.brandId, task: 'product-shots', items: shots, brief: description,
        background: text(body.background), imageDataUrl: await visionReference(deps, reference) }, shots, shots.length);
      const results = await runEach(items, async item => {
        const image = await imageFor(deps, body, 'product-shots', item.prompt, reference);
        return { ...image, shot: item.key, shotName: item.label };
      });
      return { success: true, shots: results, productDescription: description };
    }
    case 'generate-variations': {
      if (!reference) throw new Error('reference_image_required');
      const scenes = strings(body.scenes).slice(0, MAX_OUTPUTS);
      const featureType = text(body.featureType) || 'variations';
      if (scenes.length) {
        const items = await planOrTemplate(deps, { brandId: body.brandId, task: 'scene', items: scenes,
          imageDataUrl: await visionReference(deps, reference) }, scenes, scenes.length);
        const variations = await runEach(items, async item => ({ ...await imageFor(deps, body, featureType, item.prompt, reference), scene: item.key }));
        return { success: true, variations };
      }
      const count = Math.min(4, Math.max(1, Number(body.count) || 1));
      const [item] = await planOrTemplate(deps, { brandId: body.brandId, task: 'variations', brief: text(body.prompt),
        strength: typeof body.strength === 'number' ? body.strength : undefined, imageDataUrl: await visionReference(deps, reference) }, [], 1);
      // One request with several candidates: the seeds differ, the instruction is shared.
      const receipt = await deps.image('edit-image', { ...baseImageBody(body, featureType), prompt: item.prompt, count, imageUrl: reference });
      const variations = (receipt.images ?? []).filter(image => image?.imageUrl);
      if (!variations.length) throw new Error('image_receipt_missing_image');
      return { success: true, variations };
    }
    case 'colorize': {
      if (!reference) throw new Error('reference_image_required');
      const colors = strings(body.colors).slice(0, MAX_OUTPUTS);
      if (!colors.length) throw new Error('colors_required');
      const items = await planOrTemplate(deps, { brandId: body.brandId, task: 'colorize', items: colors, pattern: text(body.pattern),
        imageDataUrl: await visionReference(deps, reference) }, colors, colors.length);
      const variations = await runEach(items, async item => ({ ...await imageFor(deps, body, 'colorize', item.prompt, reference), colorName: item.label }));
      return { success: true, variations };
    }
    case 'remove-background': {
      if (!reference) throw new Error('reference_image_required');
      const background = text(body.newBackground);
      const backgroundReference = text(body.backgroundReferenceImage);
      if ((!background || /transparent/i.test(background)) && !backgroundReference) {
        return { success: true, resultUrl: await deps.cutout(reference), transparent: true };
      }
      const prompt = backgroundReference
        ? 'Replace only the background of image 0 with the scene shown in image 1. Keep the product in image 0 exactly unchanged.'
        : `Replace only the background with: ${background}. Keep the product exactly unchanged, with natural edges and matching light.`;
      const receipt = await deps.image('edit-image', { ...baseImageBody(body, 'remove-bg'), prompt, count: 1,
        imageUrls: backgroundReference ? [reference, backgroundReference] : [reference] });
      const image = firstImage(receipt);
      return { success: true, resultUrl: image.imageUrl, storagePath: image.storagePath, imageId: image.imageId };
    }
    case 'upscale': {
      if (!reference) throw new Error('reference_image_required');
      const scale = [2, 4].includes(Number(body.scale)) ? Number(body.scale) : 2;
      const resultUrl = await deps.upscale(reference, { scale, sharpness: Number(body.sharpness) || 0, denoiseLevel: Number(body.denoiseLevel) || 0 });
      return { success: true, resultUrl, scale };
    }
    default:
      throw new Error(`provider_action_not_composite:${action}`);
  }
}

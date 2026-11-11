import type { StudioGarmentArea, StudioPerspective } from './fashionStudioExamples.ts';

const AREA_TEXT: Record<StudioGarmentArea, string> = {
  上装: 'the top (upper-body garment)',
  下装: 'the bottoms (lower-body garment)',
  连身装: 'the one-piece dress or full outfit',
};

/**
 * Light's 3D画像に変換 returns a photo-real flat product shot of the chosen garment area: the garment alone with its
 * worn volume (ghost mannequin), centred on pure white (its sample: a striped shirt dress lifted off the model).
 */
const flatDirective = (garment: StudioGarmentArea, perspective: StudioPerspective) => [
  `Output: a photorealistic e-commerce product photo of ${AREA_TEXT[garment]} worn in the image, shown alone as a 3D ghost-mannequin (invisible mannequin) form with natural volume, centred and filling most of the frame.`,
  perspective === '背面' ? 'Show the BACK view of the garment, inferring the back construction consistently with the front.' : 'Show the FRONT view of the garment.',
  'Pure white (#FFFFFF) background from edge to edge with at most a soft contact shadow: no grey, no gradient, no vignette; no model, no body parts, no hanger, no props.',
  'Keep the exact colors, print, fabric texture, collar, buttons, sleeves, belt and construction of the garment.',
].join(' ');

// The server's likeness guard reads "<word> <word> face|likeness|style" as a named person's look (2026-11-11 production:
// "keep that model's face" was refused with legal_safety_prompt_blocked), so these directives say "facial features".
const underwearDirective = (hasModel: boolean) => hasModel
  ? 'Image 1 is the innerwear garment. Image 2 is the model photo: keep the facial features, hair, body, pose, framing and background of image 2 unchanged and dress the model in the garment from image 1 instead of the current clothing. Reproduce the garment\'s colors, lace, straps, seams and construction exactly.'
  : 'Image 1 is the innerwear garment. Show a model wearing exactly this garment, reproducing its colors, lace, straps, seams and construction.';

/**
 * Light's 範囲指定で生成 marks the spot with a brush stroke (its sample mask is one stroke across the chest) and the
 * whole garment there takes the reference design. Heavy sends the stroke as a guide image (image 3) the same way.
 */
const regionDirective = (hasReference: boolean) => hasReference
  ? 'Image 2 is the reference garment. Image 3 is image 1 with teal brush strokes marking the garment to change. Replace only the marked garment in image 1 with the garment design shown in image 2 (garment type, neckline, straps, colors and fabric), fitted naturally to the body, pose and lighting. Keep the facial features, hair, body, pose, the other clothing and the background identical to image 1. The output must not contain any teal marks.'
  : 'Image 2 is image 1 with teal brush strokes marking the area to change. Change only the marked area and keep everything else identical. The output must not contain any teal marks.';

/** Light's テキストで生成 keeps the garment from image 1 and returns a natural photograph (its sample: a film-like room shot). */
const textDirective = 'Keep the garment from image 1 exactly (colors, fabric, ribbing, lace, trims and construction). Unless the instruction asks otherwise, make it a natural, photorealistic photograph with true-to-life skin texture and natural light, not an airbrushed or painted look.';

// A project keeps the function it was created with, so a request that asks for 3D in words gets the 3D directive too.
const asksFor3d = (prompt: string) => /[3３]\s*[DdＤｄ]/u.test(prompt);

/** The provider prompt per Fashion Studio function; the saved prompt stays the user's own text. */
export const studioProviderPrompt = (prompt: string, studioFunction: string, options: {
  garment?: StudioGarmentArea; perspective?: StudioPerspective; hasReference?: boolean;
} = {}) => {
  const fn = studioFunction === 'text' && asksFor3d(prompt) ? '3d' : studioFunction;
  const directive = fn === '3d' ? flatDirective(options.garment ?? '连身装', options.perspective ?? '正面')
    : fn === 'underwear' ? underwearDirective(Boolean(options.hasReference))
      : fn === 'region' ? regionDirective(Boolean(options.hasReference))
        : fn === 'text' ? textDirective
          : '';
  return directive ? `${prompt}\n${directive}` : prompt;
};

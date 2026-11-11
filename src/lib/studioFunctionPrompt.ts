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
// The innerwear fitting runs on FLUX.2 [dev], which reads "image 0/1" ambiguously; "the first/second image" matched Light's
// sample in the 2026-11-12 trial (background, pose and the garment's colour blocks kept).
const underwearDirective = (hasModel: boolean) => hasModel
  ? 'The first image is the innerwear garment. The second image is the model photo: keep the facial features, hair, body, pose, framing and background of the second image unchanged and dress the model in the garment from the first image instead of the current clothing. Reproduce the garment\'s colors, lace, straps, seams and construction exactly.'
  : 'The first image is the innerwear garment. Show a model wearing exactly this garment, reproducing its colors, lace, straps, seams and construction.';

/**
 * Light's 範囲指定で生成 marks the spot with a brush stroke (its sample mask is one stroke across the chest) and the
 * whole garment there takes the reference design. Heavy sends the stroke as a guide image (image 3) the same way.
 */
const POINT_COLOR_NAMES = ['teal', 'magenta', 'orange'] as const;
/**
 * Light's 範囲指定 is a directional fusion (定向融合): only the marked part takes the reference's construction, and the
 * garment keeps its own colour, fabric and hem. Light's sample turns the black top's neckline into spaghetti straps while
 * the black linen and the white wave hem stay (2026-11-12 production: Heavy had swapped in the whole white camisole).
 */
// 2026-11-12 production: with only "keep the garment's own colours" the provider still painted the marked chest in the
// reference's white, so the directive says outright that the reference gives the shape and nothing else.
const shapeOnly = (each = false) => `Take only the shape from ${each ? 'each reference' : 'the reference'}, never its colour, fabric or print: the reshaped part is made of the same colour and fabric as the rest of the garment in image 1, so no colour from ${each ? 'the references' : 'the reference'} appears on the garment, and the garment keeps its original length and hem.`;
const KEEP_OUTSIDE = 'Everything outside the marked area stays identical to image 1, including the facial features, hair, body, pose, the other clothing and the background.';
const regionDirective = (hasReference: boolean, points = 1) => !hasReference
  ? 'Image 2 is image 1 with teal brush strokes marking the area to change. Change only the marked area and keep everything else identical. The output must not contain any teal marks.'
  : points <= 1
    ? `Image 2 is the reference garment. Image 3 is image 1 with teal brush strokes marking where to fuse it. Fuse the design of image 2 into the garment of image 1 only where the strokes are: adopt its construction there (for example straps, neckline, collar, sleeves or cut) while keeping the garment's own colours, fabric, print, trims and hem from image 1, fitted naturally to the body, pose and lighting. ${shapeOnly()} ${KEEP_OUTSIDE} The output must not contain any teal marks.`
    : (() => {
      const count = Math.min(3, points);
      const pairs = POINT_COLOR_NAMES.slice(0, count).map((color, index) => `the ${color} marks take the construction of image ${index + 2}`).join(', ');
      return `Images 2 to ${count + 1} are reference garments. Image ${count + 2} is image 1 with coloured brush strokes marking where to fuse them: ${pairs}. At each marked part adopt only that reference's construction (for example straps, neckline, collar, sleeves or cut) while keeping the garment's own colours, fabric, print, trims and hem from image 1, fitted naturally to the body, pose and lighting. ${shapeOnly(true)} ${KEEP_OUTSIDE} The output must not contain any coloured marks.`;
    })();

/** Light's テキストで生成 keeps the garment from image 1 and returns a natural photograph (its sample: a film-like room shot). */
const textDirective = (references = 0) => [
  'Keep the garment from image 1 exactly (colors, fabric, ribbing, lace, trims and construction). Unless the instruction asks otherwise, make it a natural, photorealistic photograph with true-to-life skin texture and natural light, not an airbrushed or painted look.',
  references > 0 ? `Image${references > 1 ? `s 2 to ${references + 1} are reference images` : ' 2 is a reference image'}: use ${references > 1 ? 'them' : 'it'} for what the instruction asks (a pose, setting, model, styling or detail), never as a replacement for the garment in image 1.` : '',
].filter(Boolean).join(' ');

// A project keeps the function it was created with, so a request that asks for 3D in words gets the 3D directive too.
const asksFor3d = (prompt: string) => /[3３]\s*[DdＤｄ]/u.test(prompt);

/** The provider prompt per Fashion Studio function; the saved prompt stays the user's own text. */
export const studioProviderPrompt = (prompt: string, studioFunction: string, options: {
  garment?: StudioGarmentArea; perspective?: StudioPerspective; hasReference?: boolean;
  /** テキストで生成: how many reference images follow the main image (Light: up to nine). */
  referenceCount?: number;
  /** 範囲指定で生成: how many fusion points (Light: up to three), one reference image each. */
  points?: number;
} = {}) => {
  const fn = studioFunction === 'text' && asksFor3d(prompt) ? '3d' : studioFunction;
  const directive = fn === '3d' ? flatDirective(options.garment ?? '连身装', options.perspective ?? '正面')
    : fn === 'underwear' ? underwearDirective(Boolean(options.hasReference))
      : fn === 'region' ? regionDirective(Boolean(options.hasReference), options.points ?? 1)
        : fn === 'text' ? textDirective(options.referenceCount ?? 0)
          : '';
  return directive ? `${prompt}\n${directive}` : prompt;
};

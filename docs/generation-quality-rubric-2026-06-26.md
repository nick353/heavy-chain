# Heavy Chain Generation Quality Rubric

Updated: 2026-06-26

This rubric turns generated-image review into a repeatable Heavy Chain product gate. It is based on the accepted G601 evidence:

- `output/playwright/10m-product-readiness-g601/proof-reaudit.json`
- `output/playwright/hc-10m-real-generation-qa-20260626/visual-scorecard.json`
- `output/playwright/hc-generation-polish-20260626/visual-scorecard.json`

Do not spend fresh generation credits just to apply this rubric. Use existing image files, contact sheets, DB/Storage readback, and scorecards first. Fresh generation is only justified when required evidence is missing, stale, or contradicted by readback.

## Scorecard Contract

Every generated-image scorecard must identify the feature, image path or URL, decision, notes, and these five numeric axes on a 1-5 scale:

| Axis | Pass shape | NG examples |
|---|---|---|
| `promptAdherence` | The image matches the requested feature, product, aspect, text policy, and intended usage. | Wrong feature, wrong product, missing required headline, extra copy, ignored reference image, grid when a single output was requested. |
| `apparelFidelity` | Garment anatomy, fit, fabric, silhouette, and product identity are believable and commercially usable. | Extra sleeves, warped hood, distorted neckline, plastic fabric, broken chain motif, hidden product, impossible fit. |
| `artifactSafety` | No unwanted text, logos, watermarks, UI traces, severe body errors, or obvious model artifacts. | Random text, misspellings, watermark, app chrome, deformed hands, mannequin/neck form where banned, ghost display form. |
| `composition` | The image is readable at commerce size and leaves appropriate room for the feature. | Product cropped badly, cluttered scene, poor lighting, background overwhelms garment, banner lacks copy space. |
| `commercialUsefulness` | A brand operator could use the output in Gallery, Canvas, campaign planning, product listing, or next-step editing. | Technically pretty but not usable, unclear SKU identity, confusing scene, low conversion value, requires manual rescue before use. |

Decision thresholds:

- `Pass`: average >= 4.2, every axis >= 4, and no critical NG.
- `Needs polish`: average >= 3.6, no critical NG, and the issue is prompt-fixable without changing the feature path.
- `Fail`: any axis <= 2, missing image/readback, unsafe/unwanted visible text, watermark, unusable garment distortion, or a critical feature requirement failure.

Critical NG always vetoes `Pass`, even if the average is high. For example, the earlier `variations` output was visually polished but correctly scored `Needs polish` because mannequin/neck-form presentation reduced final commerce usefulness for that lane.

## Prompt Presets

Use the production prompt builder for app flows. For QA runs, prompt presets should include a positive intent, a negative prompt, expected outcome, and feature-specific blocker terms.

Global positive quality terms:

- premium apparel commerce asset
- clear product identity
- realistic fabric texture
- finished image, not a test mock
- usable in Gallery and Canvas follow-up

Global negative terms:

- text, logo, watermark, UI artifacts, verification labels
- distorted garment, extra sleeves, broken neckline, blurry product details
- mannequin, neck form, ghost mannequin, display bust, headless torso, floating collar when not explicitly wanted
- extra limbs, deformed hands, plastic fabric, collage/grid unless requested

Feature presets:

| Feature | Required quality | Prompt preset | Must-fail / polish triggers |
|---|---|---|---|
| `campaign-image` | Product is the hero with premium campaign lighting and clear chain detail. | Premium black chain hoodie hero campaign image, controlled studio shadows, clean negative space, no visible text unless requested. | Product secondary to background, chain detail invisible, random copy/logo/watermark. |
| `product-shots` | Catalog-ready front product view, accurate silhouette, fabric, and lighting. | Ecommerce-ready hoodie product photograph, centered full garment, clean light studio background, no model. | Mannequin/display form, warped hood/sleeves, busy background, poor product crop. |
| `model-matrix` | Wearable model image with natural pose and readable garment. | Realistic fashion model wearing the hoodie, full torso visible, natural hands, neutral catalog pose. | Deformed body/hands, garment hidden, impossible fit, product identity lost. |
| `design-gacha` | Fresh apparel concept usable for Canvas or production planning. | Standalone streetwear hoodie design concept, chain graphic placement visible, apparel mockup style. | Illegible garment, random text/logo, messy layout, not a garment concept. |
| `scene-coordinate` | Lookbook scene where outfit context helps but does not bury the hoodie. | Black chain hoodie in premium urban lookbook scene, garment front and chain motif visible, coordinated styling. | Product hidden, scene overwhelms garment, chain motif absent, distorted clothing. |
| `multilingual-banner` | Banner composition with exact requested text only. | Premium ecommerce banner, product hero, clean negative space, exactly requested headline. | Misspelled required text, extra words, unreadable typography, watermark. |
| `remove-bg` | Cutout-like isolated product with crisp edges. Current path accepts white-background-ready output; alpha transparency must not be implied unless proven. | Isolated hoodie product cutout on pure white background, crisp edges, natural silhouette, transparent-background-ready. | Rough edges, mannequin/neck form, busy background, claiming alpha transparency without proof. |
| `colorize` | Recolor preserves garment structure and chain material. | Hoodie recolor concept, preserve chain design, target fabric color clearly changed, metallic accents retained. | Color bleeding, lost chain motif, structure changed, unrealistic material. |
| `upscale` | Detail/upscale output shows sharper natural texture without fake artifacts. | Ultra-sharp product detail photograph, crisp textile fibers, chain embroidery detail. | Soft focus, wax/plastic texture, invented text/logo, low-detail output. |
| `variations` | Single finished same-product variation, not a collage, with natural garment presentation. | One standalone ecommerce campaign variation, same product identity, visible chain detail, no mannequin/neck form/collage. | Grid/collage, mannequin/neck form, SKU identity drift, hidden chain detail. |

## Review Procedure

1. Confirm readback first: job completed, image exists, Storage/signed URL proof is available, and cleanup scope is marker-bound when applicable.
2. Open the actual image or contact sheet. Do not accept readback alone as image quality proof.
3. Score all five axes, write a concrete note, and set `Pass`, `Needs polish`, or `Fail` using the thresholds above.
4. Run `npm run verify:generation-scorecard -- --scorecard <path> --readback <path>` for each scorecard before using it as child evidence.

## Existing Evidence Baseline

G601 accepted 10/10 features without fresh re-generation because `proof-reaudit.json` reconciled the primary scorecard, polish scorecard, clone decision, Storage/readback counts, and actual image paths. The only prior `Needs polish` feature, `variations`, was resolved in `hc-generation-polish-20260626` by removing mannequin/neck-form presentation from the output.

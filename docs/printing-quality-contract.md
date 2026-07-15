# Printing quality contract

Status: Stages 2–4 have local implementation and code-review evidence. The Stage 5 approval-pack harness is in progress. Chrome/Profile 2 pixel/download readback, real benchmark assets, automatic semantic recognition, AI high-resolution matting, 3D cloth warp, realism, manufacturing output, and user approval are not certified.

## Product boundary

The first supported domain is one clearly visible garment, front or three-quarter view, with a visible print surface and source imagery of at least roughly 1024 px on the long edge. Exact placement and the current manual garment-mask editor remain available after a usable garment cutout has been obtained.

Low-confidence, cropped, multi-person, multi-garment, highly reflective, sheer, heavily occluded, or otherwise out-of-domain inputs must not silently report a semantic surface success. They must return an explicit reason. Exact rendering and manual editing remain available after at least one usable garment cutout exists; entering manual correction directly from a total automatic-cutout failure is a known pending gap. “Works on every image” is not a valid release claim.

## Pipeline and immutable fallbacks

The target pipeline is:

`SourceAsset -> GarmentMatte -> SemanticSurfaceMap -> Placement -> WarpField -> Shading/Occlusion -> MockupRender`

Manufacturing export is a separate output with its own physical dimensions, DPI, bleed, color profile, and manifest. A mockup PNG is not print-ready manufacturing data.

The exact renderer and manual garment mask are compatibility lanes once a usable garment candidate exists. Adding a surface map must not change an omitted-surface request signature, snapshot shape, or exact output. A surface request may never silently fall back while still being labelled `semantic-ready`.

### Stage 1 deterministic edge candidate

The production UI exposes `高精度エッジ（試験）` as an optional candidate after the unchanged default `auto` candidate. It runs the deterministic source-size alpha refinement defined below on the already-created garment cutout. It does not run a second segmentation model, infer garment parts, or establish semantic/high-resolution AI matting quality.

`auto`, `detail`, `strict`, and `manual` remain available. Optional candidate failures are isolated; a failed or oversized refined candidate cannot remove the required auto result, successful legacy candidates, or a selected manual result. Manual editing removes stale refinement metrics because the edited alpha is a new mask revision.

### Stage 1b tap-to-garment model boundary

The `服をタップしてAIマスク` flow records the operator's tap intent and forwards the bounded crop to the cutout pipeline. A high-confidence colour-region proposal can be forwarded immediately after the tap; a low-confidence neighbourhood fallback remains an explicit Apply step. A tap selects `u2net_cloth_seg` only when the build explicitly provides `VITE_REMBG_CLOTH_SEG_MODEL_URL`; the default production build remains `silueta` until that approximately 176 MB clothing model is deployed and independently checked. Automatic selection and rectangle/range selection never switch models implicitly. When the cloth model is configured, the uniform-background fast path is skipped for tap crops so it cannot silently bypass the requested model; model load/inference failure still returns to the existing bounded cutout candidate picker and manual keep/remove editor. The tap crop is a selection proposal, not proof of garment-part recognition, and the UI must not label the fallback as semantic success.

## Surface-map contract

- All planes use source-image pixel coordinates and have identical dimensions.
- Alpha is 0–255: 0 means excluded and 255 means fully included.
- Priority is `occluder > forbidden > conditional > printable > garment`.
- Conditional pixels are printable only under an explicit policy.
- Occluders are removed from printable alpha and retained for later re-composition.
- The surface conformer accepts an optional source-grid occluder plane. It attenuates print alpha by `(255 - occluderAlpha) / 255` without replacing the garment source, so future seam/arm/overlap re-composition can restore the occluding pixels. The plane is dimension- and buffer-validated, and omitted occluders preserve the existing bytes.
- Runtime typed arrays are function-local and never stored in recursively frozen snapshots.
- Snapshot-safe planes use `png-alpha-v1` plus declared dimensions and a content hash.
- Canonical hashing is SHA-256 over length-prefixed encoding version, width, height, and decoded PNG RGBA bytes. The Stage 2 manual plane implements generation plus decoded-PNG dimension, source, and content validation; future semantic plane encodings must use the same contract.
- The current pure compositor returns typed failures for non-positive, mismatched, malformed, or over-budget runtime plane dimensions. The manual encoded plane now returns typed failures for capacity, dimensions, visible RGB, source hash, content hash, and missing ready-plane errors.
- Whole-garment compatibility maps are `fallback-required`, confidence 0, with a non-empty `fallbackReason`.
- Surface identity (`version`, `sourceHash`, `contentHash`, `manualRevision`, `status`) participates in request identity and stale-result rejection.

### Stage 2 manual printable surface

The first printable-area implementation is explicitly manual. A user edits an alpha plane with the existing keep/remove brush and separately enables design clipping. Creating a plane does not enable it automatically. The garment remains whole; only the design canvas is clipped. Garment or garment-mask changes invalidate the plane, while design placement changes do not.

Manual planes use `manual-ready`, not `semantic-ready`. Their source hash is computed from the current decoded garment RGBA, and their content hash is computed from a canonical white-RGB alpha plane. Snapshot construction decodes and revalidates dimensions, source identity, and content identity before rendering. The source plane is contained into stage coordinates using the same bounds for live preview and final composition. Missing, stale, mismatched, oversized, or hash-invalid enabled planes fail visibly and do not fall back to the whole garment.

### Stage 3 experimental 2D surface conform

When a `manual-ready` printable surface is explicitly enabled, the app may add a third result labelled `布面追従（試験）`. It uses bounded 2D luminance gradients, premultiplied-alpha resampling, and restrained fold shading. The regular fabric result also accepts optional stage dimensions so it can add a bounded local fold-contrast term without changing geometry or alpha. It is not automatic surface recognition, a 3D simulation, or a realism guarantee.

The exact and fabric results are committed first and remain available when the experimental pass is out of domain, exceeds its deadline, or fails. The experimental pass rejects insufficient source resolution, invisible design/surface intersections, small or frame-cropped surfaces, clipped luminance, excessive high-frequency detail, malformed dimensions, and over-budget inputs. It never substitutes a whole-garment surface for a missing manual plane.

### Stage 4 high-resolution mockup output

The mockup renderer offers the legacy 720×900 output and an optional 1440×1800 PNG. High-resolution geometry is derived by first applying the legacy 720×900 integer rounding rules and then multiplying every contain bound, design center, and design box by two. This prevents independent rounding drift while leaving the default path unchanged.

The 2D experimental conformer now uses a bounded ROI wrapper at 1440×1800 instead of a blanket skip. It scans the full clip with the same deadline, keeps the legacy direct path unchanged below the one-million-pixel budget, and returns a typed ROI-too-large failure if the crop itself would exceed the safety budget. Exact and fabric results remain downloadable at the selected dimensions. These PNGs are higher-resolution mockups, not manufacturing-ready DPI, CMYK, bleed, or ICC output.

The ROI path is fail-closed: source, design, garment alpha, and printable alpha must share the exact full-stage grid and buffer lengths. Nonzero printable alpha defines processing support, `alpha >= 8` defines visibility and preserves the existing full-stage edge-contact rule, and a 16 px halo retains the current blur, gradient, panel-warp, and bilinear sampling support. The crop is at least 600 px wide when the stage permits so the existing 12 px panel-warp cap does not become stronger after cropping. Scan, crop, conform, and blit share one absolute deadline; ROI failure never removes or relabels the exact and fabric results.

The same conformer may also apply a narrow panel-profile warp when the clip alpha profile is stable enough to measure from `alpha >= 64` rows. Every row between the first and last active row must contain exactly one contiguous run; any empty row inside the span, multi-run row, or other profile break disables the warp and preserves the disabled export byte-for-byte. When it does apply, the warp is bounded by the measured row profile and the existing gradient displacement remains capped independently.

## Edge refinement contract

The first edge implementation is a deterministic library connected only as the optional `高精度エッジ（試験）` production candidate. It processes source-resolution RGBA with a 3×3 clamped-border filter, spatial weights from `[1,2,1]`, and accepts guide neighbours only when maximum RGB channel distance is at most 32. Only alpha 8–247 is refined; transparent exterior, opaque interior, and all RGB bytes stay unchanged. Weighted alpha uses nearest-integer rounding. Inputs above 16 million pixels fail with `EDGE_REFINEMENT_PIXEL_LIMIT_EXCEEDED`.

Color decontamination is separate and only changes RGB at alpha 8–247 using:

`round(clamp((observed - (1 - alpha) * background) / alpha, 0, 255))`

It is not connected to the current production path, preventing double application with the existing cutout decontamination.

## Benchmark program

The release corpus target is 432 fixed garment/artwork tuples:

| Stratum | Cases | Coverage |
| --- | ---: | --- |
| S0 pixel oracle | 64 | RGBA, 1 px detail, text, transparency, transforms, six layers, clip/order |
| S1 clean catalog | 96 | garment categories, colors, flat/hanger/mannequin |
| S2 worn/on-model | 96 | front/three-quarter/side, poses and occlusion |
| S3 complex surface | 64 | pleats, seams, collars, pockets, zips, knit/denim/satin |
| S4 adversarial/OOD | 64 | crop, blur, low contrast, multiple subjects, sheer/reflective, EXIF/ICC |
| S5 paired realism GT | 48 | controlled blank/printed photos and known-UV 3D renders |

Stage 0 currently supplies only a 16-case procedural seed manifest. It is not a realism benchmark. The 64-case PR corpus, annotations, assets, and full runner remain required.

### Stage 5 approval-pack harness

`benchmarks/printing-approval-v1/manifest.json` is the canonical 24-case checkpoint-1 inventory. It fixes six clean catalog, six worn/on-model, six complex-surface, and six adversarial/OOD cases. The checked-in inventory intentionally starts as `not-run` with missing external assets. It is a coverage contract, not quality evidence.

`npm run build:printing-approval-pack -- --output <repo-external-directory> --allow-incomplete` writes a machine-readable report and linked HTML contact sheet. Missing files, unrun cases, and unreviewed scores are incomplete. Path traversal, symlink escape, corrupt or mismatched image formats, invalid disposition combinations, and resource-budget violations remain invalid even with `--allow-incomplete`. Correctly observed low scores, critical visual failures, and unsafe OOD behavior are quality failures rather than corrupt evidence.

The report separates `evidenceValid`, `evidenceComplete`, `qualityGatePassed`, and `readyForUserApproval`. It never creates user approval. `checkpointApproval` stays `pending` unless a separate explicit decision binds the exact manifest digest and decision-independent evidence-core digest. Changing an asset, score, observation, or manifest invalidates that decision. Generated timestamps, output paths, and the decision itself do not change the evidence-core digest.

Synthetic image-generation fixtures may be prepared with `npm run prepare:printing-synthetic-assets` after each case has a project-local `garment-source.png`. The command derives bounded previews and deterministic transparent artwork, but it does not create result renders, scores, semantic observations, or approval. Synthetic garments are development coverage only and do not replace the required real-photo corpus or user checkpoint.

### Stage 7 deterministic printable-area suggestion foundation

`suggestPrintableSurface` is a pure, source-alpha-space proposal for a conservative central panel. It excludes the upper collar/shoulder region, sleeves, side edges, and lower hem by construction. Multiple foreground components, frame-cropped garments, centerline gaps, unstable width profiles, empty inputs, and tiny printable areas return typed `fallback-required` results.

This proposal is not garment-part recognition and never reports `semantic-ready`. Stage 8 connects it only to the explicit `印刷面の候補を作る（試験）` action. A successful proposal prefills the existing manual editor, where the user must review or correct it and press Apply. It creates no saved surface or enabled clipping state before Apply; the resulting surface remains `manual-ready`, clipping remains default-off, and the unchanged manual editor remains available after every typed fallback.

Suggestion work is guarded by a monotonic request token containing the exact garment URL, mask candidate, garment-mask revision, cutout request, and decoded output dimensions. A second monotonic operation generation covers manual/proposal editor open, close, and printable-surface Apply. Generate, synchronous garment selection, candidate changes, manual or other mask-editor entry, garment-mask Apply, and unmount invalidate older work. An older request cannot open the editor, set an error/status, clear a newer request's pending state, close a newer editor, or commit an old Apply. The browser adapter also requires the decoded image dimensions to equal the selected candidate dimensions and enforces the existing 750,000-byte data-URL limit before the editor can open.

### Stage 10 synthetic offline model diagnostic

`npm run build:printing-offline-model-diagnostic -- --output <repo-external-directory>` runs the checked-in 24 synthetic inputs through the pinned local Silueta model. It fixes the model SHA-256, input `input.1` shape `[1,3,320,320]`, and output `1959` shape `[1,1,320,320]`; any mismatch or non-finite result fails closed. Network fetch is disabled in the worker. Each case runs in a separate Unix process group behind a parent-owned 60-second deadline, while the run has a 20-minute session ceiling. TERM, KILL, descendant reaping, staging cleanup, and error-only publication are covered by fixtures.

This diagnostic deliberately records `synthetic=true`, `cutoutPipelineParity=false`, `browserParity=false`, `realPhoto=false`, and `userApproval=false`. It does not execute the browser cutout crop, decontamination, or production Canvas path and cannot become approval evidence. Every saved case raster and contact sheet includes the fixed warning banner outside the 720×900 raw comparison area; unmarked raw pixels are hashed in memory but never saved. The parent independently validates asset containment and resource limits, every case hash/size/dimension/banner/flag, exact file allowlists, manifest immutability, and the actual total published bytes before the staging directory is renamed into place.

### Stage 12 real-photo offline diagnostic

`npm run prepare:printing-real-photo-manifest -- --source-dir <sourcing-directory>` creates a write-once, digest-named execution manifest for the currently available real photographs. It binds original and normalized file paths, byte sizes, dimensions, SHA-256 digests, source-page and license metadata, risk tags, the sourcing manifest digest, and the download readback digest. Missing requested cases remain explicit pending blockers; they are never silently removed from coverage totals.

`npm run build:printing-real-photo-diagnostic -- --manifest <digest-named-manifest> --output <new-directory>` runs each available normalized photograph through the same pinned local model, printable-surface suggestion, and surface conformer in a separate hard-timed process group. The parent revalidates the immutable manifest and source evidence, model output fields, worker event hashes, banners, case digests, file allowlists, and exact published byte total before atomic publication.

This diagnostic fixes `synthetic=false`, `realPhoto=true`, `browserParity=false`, `cutoutPipelineParity=false`, `userApproval=false`, and `approvalEligible=false`. Pipeline completion is separate from safety disposition. An automatic success on a guarded two-piece/multiple-garment, small-area, crop/detail, reflective, or specular case is recorded as `unsafe-silent-success`, not as a pass. All other automatic successes still require manual review. The report may say only `false-success-observed` or `manual-review-required`; it is not browser parity, quality certification, or user approval.

### Stage 13 garment-parser surface adapter diagnostic

`GarmentParserSurfaceAdapter` is a model-independent, pure adapter from a categorical label raster plus an explicit class schema to the existing printable-surface suggestion contract. Garment, occluder, and ignored labels must be declared with unique byte-sized class IDs; any observed undeclared label is a typed validation failure so parser schema drift cannot bypass garment selection or occluder handling. No significant garment class fails closed; multiple significant garment classes return `selection-required` unless the caller supplies a valid preferred class. The adapter never guesses between a top, skirt, dress, trousers, or another significant garment class. A selected garment still passes through the existing component, frame-crop, profile-stability, and printable-area safety checks. Successful output is `semantic-ready`; every unsafe or malformed input remains a typed fallback or validation error.

`npm run build:garment-parser-adapter-diagnostic -- --manifest <real-photo-manifest> --parser-eval <technical-parser-evaluation> --output <new-directory>` validates the immutable real-photo inputs and technical label rasters, then publishes one atomic readback. The current ten-case technical run records 3 safe successes, 4 explicit selections, and 3 fallbacks. It binds the evaluated parser revision and model digest, but the parser itself is not bundled or production-integrated.

The evaluated FASHN Human Parser checkpoint is a 256,146,352-byte technical spike. Its readback must remain `browserParity=false`, `productionIntegrated=false`, `licenseReviewRequired=true`, and `userApproval=false`. Its size, browser runtime, product fit, and license must be approved independently before any production integration. Stage 13 does not change exact-pixel rendering, does not replace the manual editor, and does not weaken the manual fallback.

## Release gates

- Frozen regression corpus: zero critical failures.
- Exact identity: opaque, non-interpolated oracle pixels are bit-exact.
- Transformed exact: invariant/tolerance gate, because Canvas interpolation differs by platform.
- Fabric mode: same geometry and alpha as exact; only bounded RGB modulation.
- Catalog matte target: soft IoU >= 0.97, boundary F1 at 2 px >= 0.95.
- Worn/complex matte target: soft IoU >= 0.93, boundary F1 at 2 px >= 0.90.
- Forbidden-zone spill: core <= 0.1%, complex <= 0.5%.
- Warp: median reprojection <= 1%, p95 <= 2.5% of panel diagonal; no negative Jacobian.
- Skin, hair, background, wrong-panel printing, and reversed occlusion are critical failures.
- The fixed 64 OOD set may report only observed counts, for example `0/64 observed silent critical successes`; it cannot establish a universal 1% population bound.

Human review uses eight 1–5 dimensions: garment edge, printable surface, warp, fold integration, seam/occlusion, design fidelity, material plausibility, and commercial realism. Passing requires mean >= 4.2, every critical dimension >= 4, and no score <= 2. Manual correction time is a target until participant count and start/end/failure rules are frozen.

## User approval checkpoints

1. Approve a 24-case domain contact sheet.
2. Approve semantic/printable overlays for 12 hard cases.
3. Complete 10 timed manual-rescue cases.
4. Approve a 24-case blind exact/fabric A/B at 100% and 200% zoom.
5. Approve the full corpus, performance report, artifact manifest, and production readback.

The product must not be described as realistic or release-ready before checkpoints 4 and 5 are explicitly approved.

## Current Stage 0 evidence

`npm run verify:printing-foundation` is the local pure gate. Browser-only Canvas and UI behavior are verified separately in the local development build through Chrome Extension/Profile 2. Standalone Playwright is not an accepted substitute for that surface. Until a development-only Canvas oracle exists, actual renderer pixel-oracle coverage remains incomplete.

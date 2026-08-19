# Heavy Chain Product Design

Updated: 2026-08-19

## Durable Desired Future State

Heavy Chain should become the internal apparel team's unified production workspace: a desktop-first, cross-platform application where staff can choose any non-video Lightchain production capability from a shared library, complete the full input-to-generation workflow, inspect the result, save it, and continue working in Gallery, Canvas, History, or Jobs without losing context.

The experience should feel like the current Lightchain production product in information architecture, visual language, interaction patterns, workflow clarity, performance, and generated-output quality. Heavy Chain may retain its own product identity and implementation, but it should not make a Lightchain-experienced apparel operator relearn the work.

The first complete product experiences are:

1. Fabric print imagery: select garment/fabric and print assets from the library, configure placement and presentation, generate a usable apparel preview, and continue to save, edit, and reuse it.
2. AI fitting: select garment and model references from the library, configure the fitting context, generate a usable fitting image, and continue to Gallery, Canvas, History, and Jobs.

After those two experiences are production-quality for internal use, the same workspace contract should cover every other current Lightchain feature except video features.

## Primary User and Product Promise

### Primary user

The primary user is an apparel employee working on product design, merchandising, e-commerce, marketing, or related internal production tasks. The initial product is an internal beta rather than a public self-serve service.

### Product promise

An internal apparel operator should be able to:

- start from a library asset or a natural production intent;
- understand what material, settings, rights, and next action are required;
- complete any supported feature without learning backend concepts;
- see clear draft, ready, generating, completed, failed, and retryable states;
- inspect the result against the intended input and context;
- save the result and reopen it later with its source, settings, provenance, and history;
- move naturally between generation, Gallery, Canvas, History, and Jobs;
- recover from failure without losing the prior input or successful result.

## Parity Contract with Current Lightchain Production

The current Lightchain production UI is the reference baseline. A fresh reference readback should establish the canonical feature inventory and parity artifacts before feature acceptance; old recordings and historical summaries are reference-only.

Parity is evaluated across five layers:

1. Information architecture and visual system: entry points, grouping, hierarchy, layout, typography, controls, labels, empty states, and responsive desktop behavior.
2. Interaction and feature behavior: inputs, library selection, editing operations, validation, generation controls, progress, result actions, and handoffs.
3. Operational behavior: loading, failure, retry, cancellation where supported, duplicate-submit protection, and restart/resume behavior.
4. Performance: library search, route/workspace readiness, image loading, editing interactions, and other user-visible operations compared on equivalent desktop environments.
5. Generated-output and persistence quality: same intended input semantics, apparel fidelity, composition, usefulness, saved lineage, Gallery/Canvas continuity, and History/Jobs readback.

"Same generated result" means semantic and visual production parity: the same input intent should produce equivalent garment fidelity, print placement, model/fitting composition, and commercial usefulness. Pixel-identical output is not required unless Heavy and Light can use the same provider, model version, preprocessing, postprocessing, and deterministic seed.

Lightchain logos, trademarks, and proprietary brand assets are not copied. The product should match the useful workflow and design behavior while retaining Heavy Chain's own identity.

## Unified Workspace Model

Heavy Chain should present one project workspace rather than a collection of disconnected tools.

- A shared project shell keeps the active project, selected assets, generation context, and current task visible.
- A left-side catalog/search surface exposes all supported non-video features and categories.
- The central workbench hosts the selected feature without losing project context.
- A context surface shows selected library assets, settings, rights state, generation state, result metadata, and next actions.
- Gallery, Canvas, History, and Jobs remain addressable but behave as connected views of the same project and result lineage.
- Every feature uses a common lifecycle and common result handoff contract rather than inventing an isolated state model.

## Library-First Material System

The library is the primary starting point for production work. It should support the asset types needed by the non-video feature set, including garments, models, fabrics, prints, backgrounds, poses, brand materials, references, and prior generated results where applicable.

Every asset should have a stable identity, type, source/provenance, rights state, preview, canonical storage reference, and reuse history. All internal beta users can search, select, and use the supported library assets in every feature. Shared-library destructive or governance operations such as deleting, renaming, or changing rights metadata should remain administratively controlled unless a later policy explicitly broadens them.

## Scope

### In scope for the internal beta

- All current Lightchain production features except video features.
- Complete input, processing/generation, result, save, and reuse behavior for each in-scope feature.
- Fabric print imagery and AI fitting as the first fully integrated experiences.
- Shared library, project context, result lineage, Gallery, Canvas, History, and Jobs integration.
- Mac and Windows desktop use through current stable Chrome versions.
- Broad desktop widths, with a primary acceptance range of approximately 1280px to 2560px.
- Internal feedback, failure diagnostics, safe retry, and recovery behavior.

### Deferred from the current product scope

- Video generation and video-workstation execution. Video may be reconsidered as a separate product scope after the image-production workspace is stable.
- Public launch, external publishing, billing, checkout, payment, and purchase flows.
- Identity verification, OTP/CAPTCHA, security-code entry, and secret handling in the user-facing workflow.
- Literal pixel-level cloning of Lightchain output where the provider is nondeterministic or implementation conditions differ.

## Cross-Platform and Performance Direction

Desktop is the primary beta surface. Mac and Windows should provide the same supported Chrome workflow, with layout and interaction behavior remaining usable across a broad desktop-width range. Mobile is not the first beta acceptance surface, but desktop-first decisions should not create avoidable structural barriers to later responsive support.

The initial performance target is parity with the current Lightchain production baseline on equivalent hardware and network conditions. For user-visible shell, navigation, library search, asset selection, and editing interactions, Heavy should target approximately within 10% of the Lightchain baseline. External-provider generation latency should be measured separately and reported with provider/model context rather than hidden inside UI performance claims.

## Strategic Thesis

The primary bet is **one project, many production tools**: preserve the Lightchain operator's familiar workflow while making Heavy Chain's generation, material lineage, Gallery, Canvas, History, and Jobs behave as one durable system.

Supporting bets:

1. Library-first work reduces repeated uploads and makes apparel assets reusable.
2. A shared lifecycle prevents feature-specific state drift and makes failures recoverable.
3. Result lineage makes generated work trustworthy and reusable across Gallery, Canvas, History, and Jobs.
4. Fabric print and AI fitting provide the clearest first proof of the product's apparel-specific value.
5. Internal beta usage supplies concrete workflow and quality feedback before public or billing decisions are made.

## Success Signals

The desired future state is becoming real when:

- every in-scope current Lightchain feature is discoverable from the unified workspace;
- every in-scope feature supports the complete input-to-result-to-save-to-reuse contract;
- an apparel operator can complete fabric print imagery and AI fitting without leaving the project context;
- selected library materials preserve identity, rights, source, and reuse lineage;
- successful outputs remain available while a new attempt or retry is in progress;
- Gallery, Canvas, History, and Jobs agree on the same result and status;
- the same workflows remain usable on Mac and Windows Chrome across the supported desktop-width range;
- output reviews show equivalent garment fidelity, print placement, composition, and commercial usefulness to the Lightchain reference;
- internal users can identify and recover from failures without backend intervention.

## Important Gaps and Assumptions

- The exact in-scope feature count and names must be frozen from a fresh current Lightchain production readback after removing video features.
- The Lightchain baseline needs stable desktop screenshots, DOM/interaction observations, performance measurements, and representative input/output examples.
- Generated-output parity requires a written quality rubric covering apparel fidelity, print placement, model/fitting quality, composition, artifacts, and commercial usefulness.
- The library schema, source ownership, rights metadata, and shared-library governance need confirmation before broad internal use.
- Provider/model choices, cost controls, and environment configuration must support real non-video generation without weakening billing, secret, or rights boundaries.
- Internal beta staffing, representative tasks, feedback capture, and acceptance sample size remain to be defined.

## Non-Goals and Safety Boundaries

- Do not copy Lightchain's logos, trademarks, or proprietary brand assets.
- Do not treat static tests, mock outputs, screenshots, or local previews as proof of real generation or production parity.
- Do not add billing, checkout, payment, public publishing, identity verification, OTP/CAPTCHA, or secret-entry flows to the internal beta by implication.
- Do not declare a feature complete until its input, processing/generation, result, persistence, and reuse behavior are verified at the appropriate evidence layer.

## Project Summary

Heavy Chain is an internal, desktop-first apparel production workspace that aims to make the current Lightchain production experience available across every non-video capability while adding durable library, generation, result, Canvas, Gallery, History, and Jobs continuity. Fabric print imagery and AI fitting are the first complete proof experiences; the long-term product is one coherent project workspace rather than a set of disconnected feature pages.

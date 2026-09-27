# Heavy Chain cross-surface Astra input packet

- Captured: 2026-09-27T07:29:00Z
- HEAD: c1ba88d05006a5ac3933f7b4eb7956aa436a8a17
- Existing Opus plan: `324a1767-2456-4822-a565-89d1c9cb3e4b`, version 3, `plan_valid=true`
- Existing managed package: run `heavy-cross-surface-consent-adapter-20260927`, owner `/root`, package `heavy-cross-surface-astra-engineering`, route `native_astra_engineering`, model `gpt-6-astra`, effort `medium`
- Current package state: `waiting_human`, hold `automatic_dispatch_disabled`, `claim_id=null`, `start_receipt=null`; no source/provider mutation was made.

## Current source boundary

### Fitting

- `src/pages/FittingPage.tsx:657-658` derives `heavyGenerationReady` from Heavy entitlement and `:677` reads `model-matrix` entitlement.
- `src/pages/FittingPage.tsx:1423-1427` fails closed when the entitlement is not ready.
- `src/pages/FittingPage.tsx:1467-1486` calls `generateModelMatrix(...)` with `rightsConfirmed: heavyGenerationReady`, but does not pass `heavyConsent` or `heavyPreparation`.

### Canvas

- `src/pages/CanvasEditorPage.tsx:465-472` derives `heavyGenerationReady` and caller `rightsConfirmed` from a requestless `generate-image` entitlement read.
- `src/pages/CanvasEditorPage.tsx:2233-2237` fails closed before provider action when `rightsConfirmed` is false.
- `src/pages/CanvasEditorPage.tsx:2244-2251` builds only `legalSafety.rightsConfirmed`; provider action branches do not carry the shared request-local consent/preparation adapter.
- `src/pages/CanvasEditorPage.tsx:3051-3090` partial-edit path passes `rightsConfirmed` and edit context; existing edit durability/cleanup must remain unchanged.

### Image API and Cloudflare adapter

- `src/lib/imageApi.ts:147-153` supports `heavyPreparation` and `heavyConsent` in the common `invokeImageAction` options.
- `src/lib/imageApi.ts:261-300` `generateImage` accepts and forwards both fields.
- `src/lib/imageApi.ts:604-634` `generateModelMatrix` accepts only `rightsConfirmed` and does not forward either field.
- `src/lib/cloudflareApi.ts:610-654` already implements the request-local prepare → terms acceptance → rights attestation → input binding path when `heavyConsent` is supplied.

### ChatEditor

- `src/components/ChatEditor.tsx:151-153` rejects missing or stale parent readiness/input binding.
- `src/components/ChatEditor.tsx:160-174` can call edit/generate with only `rightsConfirmed`; it does not pass `heavyConsent` or `heavyPreparation`. The Opus plan keeps ChatEditor fail-closed unless Astra explicitly includes it.

## Required Astra decision

Decide the exact shared adapter boundary and request normalization for Fitting/Canvas, while preserving:

1. GeneratePage behavior and current explicit terms/rights UI.
2. Light routes' zero Heavy entitlement calls and no Heavy consent UI.
3. Server `heavy-entitlement.ts` and request binding unchanged.
4. ChatEditor fail-closed unless the bounded scope explicitly includes it.
5. Input-change invalidation of preparation, digest, and binding.
6. Offline/mock-only deterministic tests; provider, billing, R2, publication, deploy, and secrets at zero.

No implementation or external call is authorized by this packet. It only removes context ambiguity before the existing Astra package can be claimed and started.

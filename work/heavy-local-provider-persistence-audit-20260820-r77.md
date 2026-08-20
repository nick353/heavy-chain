# Heavy Chain local provider/persistence audit r77

Date: 2026-08-20
Scope: video-excluded Lightchain workflow contract, with priority fabric/printing and AI-fitting provider/result/persistence boundaries.

## result

- Fabric and printing use the real multi-image edit provider path. The request includes an explicit garment mask, `gpt-image-1`, high input fidelity, high quality, Lightchain feature metadata, input lineage, and a protected-region composite.
- The protected material/print composite is promoted only after completed provider readback and a durable remote artifact save. Its derived storage identity is kept separate from the provider source path.
- AI fitting calls the `model-matrix` Edge Function. The Edge Function creates a generation job, uploads every generated image to the `generated-images` bucket, inserts every `generated_images` row, completes the job, and returns `persistenceStatus=completed`, a non-empty `storagePath`, and per-item completion status. OpenAI is primary and the explicitly implemented Gemini provider fallback is used only for an OpenAI quota error when configured.
- Fitting promotes the result matrix and in-memory history only after every item passes the completed model-matrix readback guard and local artifact save/readback. Hydrated history uses signed remote generated-image paths plus local lineage, and Canvas reuse carries the source artifact, job, image, storage, material, model-reference, and parity metadata.

## changed

- No application or Edge Function code changed in this audit.
- Added this evidence artifact and appended the boundary/proof status to `plan.md` and `STATE.md`.

## verification

- `npm run test:provider-persistence-readback`: 12/12 passed.
- `npm run test:lightchain-provider-adapter`: 16/16 passed.
- `npm run test:lightchain-provider-coverage`: 18/18 passed.
- `npm run test:lightchain-material-contract`: 20/20 passed.
- Fitting history/resilience/unified-persistence focused suite: 18/18 passed.
- `npm run typecheck`: passed.

## proof boundary

These are local source and focused-contract results. They do not prove a live production provider response, image quality, remote save/reuse/reload, current Lightchain card enumeration, or paired Mac/Windows Chrome behavior.

## remaining blocker

- `chrome_foreground_activation_capability_unavailable`: the official Profile 2 extension still does not advertise `foreground_activation` or `management`, so the same-run production generation/save/reuse/reload proof remains fail-closed.
- `chrome_extension_target_readback_target_session_not_owned`: current-selector Lightchain card enumeration has no fresh DOM proof.
- Production-bound launch auth and human-owned beta/legal acceptance inputs remain separate unresolved gates.

## next action / restart point

After an official capability or supported target-session state change, create a new official Profile 2 owner and run the remaining same-run proof: current Lightchain parity → fabric/printing provider → result → remote save → Gallery/Canvas/History/Jobs → reuse/reload → AI fitting. Do not reuse the r77 local artifact as production proof, or reuse an old browser, binding, tab, run, or capability fingerprint.

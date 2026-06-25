# Heavy Chain Product Excellence Design

Updated: 2026-06-26

## Product Outcome

Heavy Chain should feel like a Lightchain-compatible, production-grade apparel generation workspace: users can start from a natural request or an uploaded material, get a clear generation plan, generate real outputs, inspect the results, continue into Canvas/Gallery/Jobs, and recover from worker failures without understanding backend details.

## Target User Experience

- First action is visual and intuitive: upload image or write one request.
- Every generation feature exposes an AI assistant planning entry, not only dense form fields.
- Material references, cut/mask state, layer intent, placement, and scale remain visible before generation.
- Generated images are judged against the prompt and can continue into Gallery, Canvas, Jobs, and follow-up actions.
- Mobile views keep the same workflow without long confusing panels or broken layout.
- Billing is ignored while inactive; purchase/checkout/payment/identity flows remain out of scope.

## Strategic Pillars

1. Lightchain parity where it matters: chat-first planning, image/material-first editing, board/canvas continuity, and follow-up suggestions.
2. Heavy Chain advantage: richer Runway worker path, Jobs recovery, Gallery/History persistence, Canvas finishing, and material metadata safety.
3. Evidence-first release quality: every claim needs local or Zeabur proof with screenshot/DOM/video/readback where relevant.
4. Non-billing production readiness: safe generation submit, marker-scoped DB/Storage cleanup, and no irreversible purchase/payment actions.

## Success Criteria

- All major `/generate?feature=...` lanes have a Lightchain-style planning entry or a documented reason why not.
- Campaign, product shots, model matrix, design gacha, scene coordinate, multilingual banner, remove background, colorize, upscale, and variations are verified in UI.
- Canvas/Gallery/Jobs/readback flows are verified after at least one real or approved-client generation path.
- Mobile Generate, Lightchain, Canvas, Gallery, Jobs, Marketing, Fitting, and key workspace screens are recorded with no relevant console/page/request failures.
- Docs and `STATE.md` point to the current proof bundle and do not overclaim pixel-identical Lightchain parity where Heavy Chain intentionally differs.

## Boundaries

- Allowed: code changes, local and Zeabur QA, non-billing generation jobs, marker-scoped cleanup, docs, commits, pushes.
- Stop/human-only: billing, purchase, payment, checkout, identity verification, OTP/CAPTCHA/security prompt, secrets, external public publishing.
- Preserve: existing Runway local-worker architecture, Supabase redaction rules, auth/RLS safety, marker-scoped cleanup discipline.

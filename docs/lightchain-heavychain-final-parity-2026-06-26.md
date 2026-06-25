# Lightchain / Heavy Chain Final Generation Parity

Date: 2026-06-26

## Verdict

Lightchain and Heavy Chain were not identical before this pass. Lightchain's generation flow is chat-first: a single request creates a generation plan, the user confirms it, then three outputs are generated into a board-like workspace. Heavy Chain production was panel-first: readiness, material workbench, detailed form fields, and generation settings appeared before the user had a Lightchain-style plan.

This pass added a campaign-image AI assistant entry to Heavy Chain production. It now accepts one request, builds a request-aware three-item plan, and only writes into the actual generation form after the user explicitly clicks `フォームへ反映`.

## Lightchain Evidence

- Entry screen: `output/playwright/lightchain-heavychain-final-parity-20260626/01-lightchain-marketing.png`
- Prompt submitted: `05-lightchain-after-submit.png`
- Plan returned before generation: `07-lightchain-detail-result.png`
- Three generated outputs complete: `16-lightchain-after-third-wait.png`
- Generated files:
  - `lightchain-generated-01.webp`
  - `lightchain-generated-02.webp`
  - `lightchain-generated-03.webp`
- Layer tab evidence: `17-lightchain-layer-settings.png`

Observed behavior:
- Single upload/prompt entry.
- AI returns a table-like plan for three images.
- User confirmation is needed before continuing.
- Outputs appear in the conversation/canvas area.
- Follow-up suggestions are generated after completion.

## Heavy Chain Before

- Production authenticated screen: `21-heavychain-auth-generate-initial.png`
- Prompt entered before fix: `22-heavychain-auth-generate-prompt-entered.png`
- Recording: `heavychain-auth-recording/page@ec52d77e0a961d810c2c7f36d96da277.webm`

Observed behavior:
- The generation screen opened with readiness cards, Runway worker status, material workbench, and detailed campaign fields.
- The first visible textarea in automation was the material memo, not the primary generation concept.
- It was more powerful, but less Lightchain-like and more difficult for a user expecting a chat-first flow.

## Heavy Chain After

- Local preview final proof: `27-heavychain-local-separated-plan-summary.json`
- Screenshot: `27-heavychain-local-separated-plan.png`
- Recording: `heavychain-local-separated-plan-recording/page@79dd5878360cbd65bb807030c57b1f96.webm`
- Production final proof: `29-heavychain-prod-separated-plan-summary.json`
- Production screenshot: `29-heavychain-prod-separated-plan.png`
- Production recording: `heavychain-prod-separated-plan-recording/page@b52bb938501de902cfe75f18d8f9b916.webm`

Final assertions:
- `afterPlanOnly.baseConceptFilled=false`: creating the plan no longer mutates the actual generation form.
- `afterPlanOnly.dynamicPlanFound=true`: the generated plan reflects the request.
- `afterReflect.baseConceptFilled=true`: clicking `フォームへ反映` copies the request into the actual generation form.
- `afterReflect.generateCountThree=true`: the Lightchain-style three-output plan is reflected in generation count.
- `afterReflect.defaultCopyInjected=false`: no hidden English placeholder copy is injected.
- `relevantEvents=[]`: no page errors were captured.
- Production asset: `https://heavy-chain.zeabur.app/assets/index.D4pPnPgW.js`

## Remaining Gap

The local implementation is closer, but not yet fully identical to Lightchain:

- Lightchain generates and confirms inside a dark, board-like chat workspace; Heavy Chain still keeps the richer material workbench and side navigation.
- Heavy Chain's assistant plan is deterministic local planning, not a real LLM conversational response.
- It is still not pixel-identical to Lightchain because Heavy Chain intentionally keeps the richer material workbench, Runway readiness, Jobs, Gallery, and Canvas surfaces.

## Verification

- `npm run typecheck`: pass
- `npm run lint -- --max-warnings=0`: pass
- `npm run build`: pass
- Local Playwright recording and DOM proof: pass
- Production Zeabur Playwright recording and DOM proof: pass
- Final Codex review attempt: blocked by usage limit, after two earlier reviews found and helped close the main issues.

# Heavy Chain local performance and scale gate r76

## result

The current local G606 performance/scale verification passed.

## verification

- Command: `npm run verify:g606-performance`
- Run: `g606-2026-08-20T07-22-28-567Z`
- `ok=true`, `issues=[]`
- Thresholds passed: ready ≤ 5000ms, index JS ≤ 750000 bytes, canvas JS ≤ 450000 bytes, heap ≤ 75000000 bytes.
- Gallery stress: 500 total images, initial rendered tile cap 60.
- Canvas stress: 180 persisted objects; 2 canvases rendered, 1 non-blank/colored canvas; PNG export valid, 3,901,628 bytes, 3348×9948.
- Browser events: console errors 0, page errors 0, actionable request failures 0. The 24 raw request failures were non-actionable aborted external image/font requests.
- Cleanup: browser closed and preview process group terminated; no issues.

## boundary

This is local preview Chromium performance/scale evidence. It does not prove production provider latency, real external model output, or paired Mac/Windows Chrome performance.

## next action

After the official Chrome capability/session blocker and production auth/operator gates change, rerun the production-bound performance and workflow proof in a fresh Profile 2 owner.

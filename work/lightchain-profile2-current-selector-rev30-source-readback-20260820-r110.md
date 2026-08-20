# Lightchain current-selector source readback r110

Updated: 2026-08-20

## result

Fresh official Chrome Plugin/Profile 2 target-scoped read-only readback was
completed for the current Lightchain source homepage and the three priority
routes. No selected tab, claim, focus, upload, generation, save, reuse,
recording, or external effect was used.

## selector and same-run proof

- preflight: `status=ready`, `exact_blocker=null`
- selector: `chrome_plugin` / Profile 2 / `signed_chrome_extension_profile2`
  / revision `30`
- browser-client: `-ea87-4fa5-89f8-5e71eebaba72`
- same-run `list -> get -> openTabs()` completed; initial open tabs: `2`
- advertised capabilities: browser `viewport`; tab `pageAssets` / `cdp`
- `foreground_activation` / `management`: not advertised

## route readback

| route | tab | URL/title | visible source contract |
|---|---:|---|---|
| `/` | `1980904578` | `https://jp.linkaigc.com/` / `Lightchain AI` | Japanese/help, apparel hero, four categories, non-video and video cards, case tabs |
| `/tools/fabric` | `1980904579` | `https://jp.linkaigc.com/tools/fabric` / `Lightchain AI` | fabric/print/line-art/flat-sketch tabs, model/design image, fabric image, keyword, ratio, reset/history, deprecation notice |
| `/tools/printing` | `1980904580` | `https://jp.linkaigc.com/tools/printing` / `Lightchain AI` | print upload, `リセット`, `スポット`, `全体`, `AI生成`, history, deprecation notice |
| `/model` | `1980904581` | `https://jp.linkaigc.com/model` / `Lightchain AI` | AI fitting, single/multi task, clothing image, auto-convert, description/reference/model-set-photo, Smart/1K, history |

Fabric and printing reached `readyState=complete`. Homepage and model were
still `interactive` at the bounded readback point but returned the expected
visible source controls and non-empty DOM.

## parity decision

- Heavy's visible `リセット` action is restored to match the current source.
- Heavy-only `画像のプリント領域を調整` remains removed from the visible
  parity view.
- Heavy's garment reference input remains because the internal beta requires a
  library-origin garment plus print design for the practical flow; this is a
  deliberate workflow extension, not a source-account rights state.
- Source deprecation/rights messaging remains a separate state decision from
  the internal beta's usable generation entitlement.

## cleanup

- task-owned tabs: `1980904578`, `1980904579`, `1980904580`, `1980904581`
- `cleanup_verified=true`

## remaining blocker

Provider generation → save → reuse → reload remains
`chrome_foreground_activation_capability_unavailable` because the official
Profile 2 distribution does not advertise the required foreground capability.

## next action

Build and deploy the corrected reset parity, then run one fresh Heavy
`/tools/printing` target-scoped readback. Keep generation/persistence proof
gated until the official capability advertisement changes.

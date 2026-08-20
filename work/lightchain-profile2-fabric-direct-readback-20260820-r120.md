# Lightchain direct fabric route readback r120

## result

Fresh same-owner source comparison for the current Lightchain production
`/tools/fabric` route completed before the Heavy toolbar alignment deployment.

- Selector: `chrome_plugin` / Profile 2 / `signed_chrome_extension_profile2`
- Revision: `30`
- Preflight: `status=ready`, `exact_blocker=null`
- Browser-client boundary: `2352e2cb-9a95-4189-96cb-8cf9593a7538`
- Browser id: `-9cb2-499b-b4f6-315c7a18ffc1`
- Target: task-owned tab `1980904696`
- URL/title: `https://jp.linkaigc.com/tools/fabric` / `Lightchain AI`
- DOM: `readyState=complete`, body length `315`, visible controls `16`
- Cleanup: `cleanup_verified=true`; created tab `1980904696` closed

## source controls

The current source route exposed the following compact toolbar and feature
groups before the fabric controls:

- `ツールバー`
- `デザインツール`
- `フィッティングツール`
- `グラフィックデザインツール`
- `衣類生産ツール`

It also exposed `生地イメージ`, `プリントイメージ`, `線画の実写化`,
`平絵生成`, reference image inputs, keyword input, automatic image ratio,
`生成履歴`, and the current `権限がありません` / feature-retirement notice.

## Heavy parity action

The source toolbar was missing from the Heavy feature-detail frame. Heavy now
renders the same five source labels above its non-video feature controls and
routes the four groups into Heavy's corresponding non-video catalog categories.
Implementation commit: `e0c0d1e` (`align Lightchain feature toolbar`).

This is a UI parity correction only. It does not claim source provider
generation, result quality, persistence, reuse, or rights completion. The
source permission/retirement state is preserved as source evidence and is not
copied into Heavy's internal provider gate.

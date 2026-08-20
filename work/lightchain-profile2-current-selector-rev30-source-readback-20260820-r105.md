# Lightchain current-selector source readback r105

Updated: 2026-08-20

## result

Fresh official Chrome Plugin/Profile 2 target-scoped read-only readback
completed for the current Lightchain source homepage and three priority
routes under selector revision `30`.

## selector and owner proof

- backend: `chrome_plugin`
- profile: `Profile 2` / `profile2`
- surface: `signed_chrome_extension_profile2`
- revision: `30`
- preflight: `status=ready`, `exact_blocker=null`
- browser-client: `-f254-4b2a-89ba-a4df740b2b71`
- extension instance: `64b91b0b-80a7-4bc8-8d1a-da222c416685`
- session boundary: `305552a7-0ffb-4fdc-963c-509a94533082`
- owner session/thread: `01a01576-c224-7d81-902f-561719dc45a5` /
  `01a01576-c224-7d81-902f-561719dc45a5`
- owner turn: `01a01e87-f2d3-7852-8530-b5e947af14be`
- initial `openTabs()`: success, 2 tabs

## current Lightchain route readback

All four task-owned tabs reached `readyState=complete`, were read in the same
owner, and were cleaned up. Existing unrelated tabs were untouched.

| Route | Title | Current visible source contract |
|---|---|---|
| `/` | `Lightchain AI` | Japanese/help controls, apparel-focused hero, prompt, four categories, case tabs, non-video/video cards and case content |
| `/tools/fabric` | `Lightchain AI` | fabric image, print image, line-art/photo, flat-sketch tabs; model/design image and fabric image inputs; deprecation notice with `今すぐ体験`; keyword; ratio; `権限がありません`; `生成履歴` |
| `/tools/printing` | `Lightchain AI` | same tool tabs; deprecation notice; print upload; `スポット` / `全体`; image upload; `AI生成`; `生成履歴` |
| `/model` | `Lightchain AI` | `AIフィッティング`; single/multi task; clothing image; description/reference/model-set-photo inputs; background textarea; `スマート`; `1K`; `権限がありません`; `生成履歴` |

## parity findings

- The current Lightchain `/tools/fabric` source does not visibly expose Heavy's
  `コットン` / `デニム` / `サテン` / `リネン` buttons.
- The current Lightchain fabric/printing routes show the deprecation notice
  and `今すぐ体験` link; Heavy's current production readback instead shows a
  hydrated workbench without that source notice.
- Lightchain fabric shows `全削除` and the rights-disabled state; Heavy shows
  additional Gallery/variant controls in the current readback.
- These are current source UI differences, not provider-generation proof. No
  click, upload, rights confirmation, generation, save, reuse, recording, or
  external effect was performed.

## cleanup

- task-owned source tabs: `1980904562`, `1980904564`, `1980904566`, `1980904568`
- `cleanup_verified=true`
- remaining tabs were the pre-existing new-tab and unrelated job tab

## remaining blocker

Production provider generation/result/save/reuse/reload remains
`PENDING_CONFIRMATION` under
`chrome_foreground_activation_capability_unavailable`. This artifact is a
fresh source UI contract and does not claim business completion.


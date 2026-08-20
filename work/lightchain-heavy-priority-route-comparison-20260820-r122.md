# Lightchain / Heavy priority route comparison r122

Date: 2026-08-20 JST

## Fresh readback boundary

- Selector: `chrome_plugin / Profile 2 / signed_chrome_extension_profile2 / revision=30`
- Preflight: `status=ready`, `exact_blocker=null`
- Browser: `-6537-48dd-a4ec-3f5a128601a2`
- Boundary: `58b83b22-cbef-4ab3-b365-e5cd5758594a`
- Same-run `list -> get -> openTabs` succeeded with two pre-existing tabs.
- Four target-owned tabs were provisioned, read, and closed: `1980904702`,
  `1980904704`, `1980904706`, `1980904708`.
- All four routes returned `readyState=complete` and page title `Lightchain AI`.
- Cleanup was verified for every target; no selected/focus/claim, writer lease,
  upload, generation, save, reuse, recording, AOS change, or external effect occurred.

## Printing comparison

Lightchain `/tools/printing` fresh DOM:

- Source toolbar: `ツールバー`, `デザインツール`, `フィッティングツール`,
  `グラフィックデザインツール`, `衣類生産ツール`.
- Material tabs: `生地イメージ`, `プリントイメージ`, `線画の実写化`, `平絵生成`.
- Visible actions: `プリントをアップロード`, `リセット`, `スポット`, `全体`,
  `AI生成`, `生成履歴`.
- No file input was exposed in this account state; the page showed the current
  source retirement notice and `権限がありません`-style restricted state.

Heavy `/tools/printing` fresh DOM:

- The same source toolbar and material tabs are present.
- The practical internal-beta flow exposes garment and print library/upload
  inputs, mask confirmation, placement editing, output resolution, `AI生成`,
  and History/Gallery/Canvas/Jobs destinations.
- The account also had a prior persisted provider result, so result cards and
  mask/placement controls were visible in this readback.

## AI fitting comparison

Lightchain `/model` fresh DOM:

- `AIフィッティング`, `シングルタスク`, `マルチタスク`, `衣服の画像 (0/4)`,
  `説明生成`, `参考画像`, `モデルのセット写真`, `スマート`, `1K`,
  `生成履歴`, and a restricted `権限がありません` state.

Heavy `/model` fresh DOM:

- The same fitting title, task tabs, clothing count, input tabs, smart/1K
  controls, and history route are present.
- Heavy additionally exposes the internal-beta `AI生成` action and the
  practical provider input flow; the source readback did not expose that action
  because the source account was permission-restricted.

## Decision boundary

The source and Heavy structures now align for the common visible controls.
The remaining visible differences are not safe to remove based on this readback:
Lightchain's current account is restricted/retirement-state, while Heavy is
showing the required internal-beta generation and persisted-result state.
Copying the source `権限がありません` or removing Heavy inputs would contradict
the approved goal that all internal users can use the practical flows. Keep this
as `PENDING_CONFIRMATION` until a source account with the intended production
permission state is available.

Separate blocker: `chrome_foreground_activation_capability_unavailable` for
live provider generation/save/reuse proof.

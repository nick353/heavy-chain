# Lightchain Profile 2 current-selector fresh readback r54

## Scope

- backend: `chrome_plugin`
- profile: `Profile 2`
- surface: `signed_chrome_extension_profile2`
- selector revision: `4`
- session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- turn: `01a01dab-63b8-7b03-883e-2035c6567e49`
- external_action_executed: `false`

## Fresh homepage readback

- browser-client boundary: `68c17044-1b57-4b8a-8b18-c1dac9c55ee3`
- browser id: `-bb6a-4b4e-9be5-4397944e154a`
- task-owned tab: `1980904218`
- URL/title: `https://jp.linkaigc.com/` / `Lightchain AI`
- hydration: `true`
- body length: `703`
- visible source categories: `おすすめ`, `企画デザインツール`, `AIフィッティング`, `グラフィックツール`
- visible homepage source cards include the excluded `動画ワークステーション` and non-video apparel/design cards.
- cleanup: `ok=true`, closed only task-owned tab `1980904218`.

## Fresh priority-route readback

The following was a separate fresh browser-client boundary using the same
current selector and owner lineage. Each target was provisioned through the
official target-scoped read-only contract, read after a bounded 5-second
stability wait, and then closed as task-owned.

| route | target | readyState | key visible evidence | cleanup |
| --- | --- | --- | --- | --- |
| `/tools/fabric` | `1980904227` | `complete` | `生地イメージ`, `モデル/デザイン画像`, `キーワード`, `生成履歴`, `権限がありません`; `AI生成` not visible | PASS |
| `/tools/printing` | `1980904230` | `complete` | `プリントイメージ`, `参考画像をアップロード`, `スポット`, `全体`, `AI生成`, `生成履歴` | PASS |
| `/model` | `1980904232` | `complete` | `AIフィッティング`, `シングルタスク`, `マルチタスク`, `衣服の画像`, `説明生成`, `参考画像`, `モデルのセット写真`, `生成履歴`; `権限がありません` visible and `AI生成` not visible | PASS |

## Proof boundary

- This is current Lightchain URL/title/DOM/visible-control evidence only.
- No category mutation, authentication click/input, upload, provider
  generation, result-quality comparison, save, Gallery/Canvas/History/Jobs
  persistence, reuse, reload, retry, recording, selected/focus/claim, or
  external effect was performed.
- Heavy comparison evidence remains separate: Heavy printing/model target
  readback is recorded in `work/heavy-chain-current-target-scoped-readback-20260820-r51.md`.
- Lightchain live per-feature generation/result/save/reuse/error/performance
  behavior remains `PENDING_CONFIRMATION`.

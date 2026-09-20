# Companion authenticated production evidence design

## Decision

`auth-state.json`を本番UI受入れの必須入力にしない。ログイン済みのAOS Chrome Companion task-owned session/tabを認証境界とし、認証秘密をファイルへ抽出せずに、サニタイズ済みのreadback証跡だけを保存する。

これはPlaywrightの独立browser-contextを認証済みとして扱う設計ではない。Playwright stateが必要な既存runnerは、別のisolated-browser laneとして明示的に未実行・未確認のまま残す。

## Companion lane acceptance contract

1. `companion_status`で接続Profileが1つであることを確認する。
2. 同じGoal taskの`sessionId`、`tabId`、generationを維持する。
3. 各routeは、同一tabのfresh semantic readbackと同じreadbackのscreenshotで確認する。
4. hydration待ちが必要なrouteは、ログイン確認シェルから保護UIへ遷移するまで待つ。タイムアウトはPASSにしない。
5. 認証済み判定は、origin、URL、avatar/アカウントcontrol、route固有の保護UIを組み合わせる。health、HTTP 200、静的bundle、クリックdispatchだけでは判定しない。
6. provider receipt、source-of-truth sync、reconciliation、cleanupはUI認証証跡とは別の必須層として保持する。
7. session/tab終了時はowner-scoped cleanup receiptを記録し、foreign resourceをclaim/adopt/cleanupしない。

## Evidence schema

保存してよいものは次のサニタイズ済みメタデータだけとする。

- schema/version、Goal task、Companion session/tab/generation
- production origin、route、title、readyState、observedAt
- 認証済みUIの可視marker名とroute固有marker名
- semantic/visual readbackが両方成功したか
- browser mutation、external action、provider receipt、source sync、reconciliation、cleanupの状態
- blocker、次の行動

保存してはいけないもの：Cookie、JWT、access/refresh token、Authorization header、パスワード、OTP、CAPTCHA内容、個人情報、フォーム値本文。

## Runner policy

- Companion lane: production UI route/readbackの正規経路。`auth-state.json`を要求しない。
- Isolated Playwright lane: 再現性が必要な独立context用。state fileが無い場合は`auth_state_missing`でfail-closedし、Companion証跡へすり替えない。
- Release gate: Companion laneの有効なreadbackをUI証拠として受け入れられるが、provider/business completionの条件は緩和しない。

`verify-release-gate-unified.mjs`にもCompanion証跡readbackを追加した。`readback:Companion authenticated production UI evidence`がPASSすることは、Companionの認証UI証拠がfreshであることだけを示し、他の本番readback、provider receipt、課金、法務、人手beta gateをPASSにしない。

認証state不要化によるクライアント契約の退行確認として、`npm run test:auth-bootstrap-hydration`（7/7）と`npm run test:auth-session-recovery`（3/3）を実行した。

## Current migration

2026-09-12時点で同一Companion tabにて、`/model`、`/gallery`、`/history`、`/jobs`、`/canvas/new`をreadback済み。gallery/history/jobs/canvasは初期のログイン確認シェルからhydration後の保護UIを再readbackして確認した。現在のサニタイズ済み証跡は`work/heavy-chain-companion-authenticated-evidence-20260912.json`。

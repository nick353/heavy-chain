# Heavy production avatar parity readback r37

- checked_at: `2026-08-20T13:16:31+09:00`
- deployment: `6a867e772a82f89733778c0f`
- source commit: `f861c73c8f58e2930e3ed357af3fc42754369ec0`
- deployment status: `RUNNING`
- runtime root: HTTP `200`
- remote asset: `/assets/index.CKx-RaX1.js`
- remote/local bundle SHA-256: `d5fb622c93fd280fc585600dcdf01945692222f7adc0b62225312d4c458ba0a6`
- backend: `chrome_plugin`
- profile: `Profile 2`
- surface: `signed_chrome_extension_profile2`
- selector revision: `30`
- browser_id: `-3254-4920-8656-2f06326b52bc`
- extension_instance_id: `f48b15fe-59a8-4443-8369-44b169a4da68`
- browser-client session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- turn: `01a01d58-9221-7870-930e-d8b0ffe66695`

## Same-run target readback

- task-owned provisioned tab: `1980904119`
- URL: `https://heavy-chain.zeabur.app/tools/fabric`
- title: `Heavy Chain | AI制作ワークスペース`
- hydrated fabric workbench: PASS
- header identity: `button "avatar"` present; `アカウント` label absent
- Lightchain toolbar, material tabs, input controls, rights gate, `AI生成`, and `生成履歴` remained present
- cleanup: `cleanup_verified=true`

## Boundary

- Fresh browser capability advertisement remained `viewport` only; `foreground_activation` and `management` were not advertised.
- No selected/focus/claim/foreground lease, upload, rights confirmation, provider generation, save, reuse, recording, or external effect was performed.
- Exact blocker remains `chrome_foreground_activation_capability_unavailable` for foreground-only production workflow proof.

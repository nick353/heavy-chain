# Heavy production source-toolbar readback r121

- Date: 2026-08-20 JST
- Source commit: `6a087b8`
- Zeabur deployment: `6a86e82aa158dec405723ee7` (`RUNNING`, Docker)
- Selector: `chrome_plugin / Profile 2 / signed_chrome_extension_profile2 / revision=30`
- Preflight: `status=ready`, `exact_blocker=null`
- Browser: `-b7cb-4f14-9d65-909dd3a4e7e3`
- Target descriptor: tab `1980904700`, URL `https://heavy-chain.zeabur.app/tools/fabric`, descriptor title `Heavy Chain | AI制作ワークスペース`
- Same-run page readback: URL matched, page title `Lightchain AI`, `readyState=complete`, `hydration_ready=true`

## Readback

The deployed material route rendered `data-testid="lightchain-source-toolbar"` with
the exact five labels:

1. `ツールバー` → `/lightchain`
2. `デザインツール` → `/lightchain?category=planning`
3. `フィッティングツール` → `/lightchain?category=fitting`
4. `グラフィックデザインツール` → `/lightchain?category=graphics`
5. `衣類生産ツール` → `/lightchain?category=lab`

The same readback retained the fabric input contract, Gallery entry points,
ratio controls, `AI生成`, and `生成履歴`. Visible control count was `41`.

## Cleanup and boundary

- `cleanup_verified=true`; only task-owned tab `1980904700` was closed.
- No selected/focus/claim, writer lease, upload, provider generation, rights confirmation, save, reuse, download, recording, AOS change, or external effect occurred.
- Foreground provider blocker remains `chrome_foreground_activation_capability_unavailable` because the official extension still advertises read-only capabilities only.

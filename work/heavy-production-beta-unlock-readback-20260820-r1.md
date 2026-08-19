# Heavy Chain production beta-unlock readback

- Readback time: 2026-08-20 03:31 JST
- Surface: `chrome_plugin` / Profile 2 / `signed_chrome_extension_profile2` / selector revision `6`
- Browser client: `-c908-488d-8e01-14b32f702eac`
- Session boundary: `1daa7654-a5e2-4bd5-8565-646eca0cb84b`
- Owner lineage: current Goal thread and turn; no old binding or receipt reused
- Source commit: `633ddf79faedf81fb304ca194a2f4a623bac1c29`
- Zeabur deployment: `6a85f5bcf1ea67ebf4ea683b`, `RUNNING`, `nick353/heavy-chain@main`

## Fresh target-scoped readback

The existing pre-deployment Heavy tab `1980903663` was read only and left untouched. A new task-owned tab `1980903664` was provisioned through the official allowlisted route:

`https://heavy-chain.zeabur.app/tools/fabric?fresh_readback=20260820_1832`

After hydration, the same-run URL/title/DOM readback showed:

- title: `Heavy Chain | AI制作ワークスペース`
- Lightchain header and four category controls
- `生地イメージ`, model/design input, textile input, Gallery selectors, rights attestation, `AI生成`, and `生成履歴`
- legacy `権限がありません` controls: `0`
- old plan-lock affordance: absent
- disabled buttons: only input-dependent generation actions (`AI生成して結果を出す`, `AI生成`)
- login/preparation shell: absent; authenticated workspace content rendered

The task-owned tab `1980903664` was closed through the official cleanup path. `cleanup_verified=true`, no writer lease, selected tab, claim, focus, navigation on the existing tab, provider generation, upload, rights mutation, save/reuse, recording, AOS, or external effect was performed.

## Interpretation

The hardcoded legacy plan-lock display was removed from the integrated beta surfaces while preserving the actual input, rights, brand, provider, and persistence gates. This proves source-associated production UI reflection only; it does not prove provider generation or same-run persistence/reuse.

## Remaining exact blocker

Foreground/effectful operations remain blocked by `chrome_selected_tab_readback_invalid` with supporting capability blocker `chrome_foreground_activation_capability_unavailable`. Target-scoped readback remains available.

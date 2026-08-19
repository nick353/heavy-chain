# Heavy production deployment and UI readback r2

- Date: 2026-08-20 03:20 JST
- Project: `automation-wiled`
- Service: `heavy-chain`
- Service ID: `6a318803302ffbcd03a92935`
- Environment ID: `69df815a5ae0a69725e92048`
- Deployment: `6a85f3012a82f89733777475`
- Deployment status: `RUNNING`
- Git source: `nick353/heavy-chain`, `refs/heads/main`
- Commit: `6831f365b489ec35a8bafce11e96cfc4c88cd0b7` (`Align Heavy Chain workspace with Lightchain parity contract`)
- Plan: `docker`
- Domain: `https://heavy-chain.zeabur.app/`
- HTTP readback: `200`
- Container readback: Vite preview running on `0.0.0.0:8080`; local container request returned `200`.

## Fresh Chrome Plugin/Profile 2 readback

- Selector: `backend=chrome_plugin`, `Profile 2`, `signed_chrome_extension_profile2`, `revision=6`
- Fresh browser-client: `-0dfb-44bb-b854-8a5cd12513e9`
- Session boundary: `40ba0783-fa18-45a3-a27c-94e45aea4da4`
- Owner binding: session/thread `01a01576-c224-7d81-902f-561719dc45a5`, turn `01a01b37-c1e1-7a71-a6ff-ec59b7e6606c`
- Fresh `openTabs()`: PASS; 5 tabs
- Target descriptor: id `1980903660`, title `Heavy Chain | AI制作ワークスペース`, URL `https://heavy-chain.zeabur.app/tools/fabric`
- Same-run URL/title/DOM: PASS after `1551ms` hydration; body length `726`
- Lightchain markers: `LIGHTCHAIN`, four categories, `生地イメージ`, material inputs, Gallery selectors, rights text, `AI生成`, `生成履歴`
- Heavy-only markers: none detected
- Cleanup: `cleanup_verified=true`; only task-owned tab `1980903660` closed

## Boundaries and remaining gates

- `selected()` / claim / focus / foreground lease: not used
- upload, rights confirmation, provider generation, save, reuse, recording, AOS, and external business effect: not used
- `external_effect_executed=false`
- The screen still shows `権限がありません` and empty required inputs. This is not treated as a successful provider-permission or generation proof.
- Foreground blocker remains `chrome_selected_tab_readback_invalid` / `chrome_foreground_activation_capability_unavailable`.

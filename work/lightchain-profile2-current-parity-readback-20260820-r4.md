# Lightchain current Profile 2 parity readback r4

日時: 2026-08-20 06:09 JST

## result

Fresh official Chrome Plugin / Profile 2 target-scoped read-only readbackを、同一browser-clientで実施した。

- selector: `backend=chrome_plugin`, `revision=6`
- surface: `signed_chrome_extension_profile2`
- browser-client: `-ba97-43a6-b43c-7a6f738e5036`
- owner lineage: fresh session/thread/turn bindingを使用
- homepage: `https://jp.linkaigc.com/`
- priority routes: `/tools/fabric`, `/tools/printing`, `/model`
- all four category labels were visible on the homepage: おすすめ、企画デザインツール、AIフィッティング、グラフィックツール
- homepage title: `Lightchain AI`

## route readback

All routes passed same-run URL/title/DOM readback with `hydration_ready=true`.

### Homepage

The current source surface showed the apparel-specific description, seven visible workspace/marketing/fitting/design examples, and the category structure. It also visibly contains a `動画ワークステーション` example; Heavy's video exclusion remains an intentional beta scope rule.

### `/tools/fabric`

The current controls/text included the Lightchain toolbar (`デザインツール`, `フィッティングツール`, `グラフィックデザインツール`, `衣類生産ツール`), `生地イメージ`, model/design image input, optional keyword input, `画像比率自動`, `生成履歴`, and `生地イメージ` description.

### `/tools/printing`

The current controls/text included the same toolbar, `プリントイメージ`, `生成履歴`, and the description that printing effects can be checked without preparing final artwork.

### `/model`

The current controls/text included `AIフィッティング`, single/multi-task modes, garment image input (`衣服の画像 (0/4)`), automatic flat-lay conversion, reference/model-set image inputs, `スマート`, `1K`, `生成履歴`, and the fitting description.

## changed

No Lightchain or Heavy business data was changed. No click, credential entry, upload, rights confirmation, provider generation, save, reuse, download, selected/claim/focus/foreground lease, recording, AOS change, or other external effect was performed.

Because the exact targets were absent from the fresh `openTabs()` inventory, official target-scoped provisioning created one task-owned tab per route. The homepage tab IDs were `1980903779`; priority route tab IDs were `1980903781`, `1980903784`, and `1980903787`. Only those task-owned tabs were closed through the official cleanup path.

## verification

- fresh Profile 2 `openTabs()` handshake: PASS
- target-scoped URL/title/DOM readback: PASS for homepage and all three priority routes
- hydration: `true` for all four readbacks
- cleanup: PASS; all created target tabs closed; no close failures
- selected/focus/claim/foreground lease: not used
- external action executed: `false`

## remaining blocker

This source baseline does not clear Heavy's live production gates. The latest Heavy `/tools/fabric` readback remains blocked at `heavy_target_workspace_authentication_not_ready`; provider generation remains separately blocked by `chrome_foreground_activation_capability_unavailable`.

## next action

Keep this Lightchain baseline as the current parity reference. Do not repeat the Heavy fingerprint until the user-owned Heavy Profile 2 workspace visibly leaves authentication/brand preparation. After that state change, perform one new official Heavy target-scoped readback, then proceed to the bounded provider flow only if the workspace is hydrated and the required foreground capabilities are advertised.

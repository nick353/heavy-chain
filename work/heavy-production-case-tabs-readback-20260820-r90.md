# Heavy production case-tabs readback r90

更新日: 2026-08-20

## Deployment

- local commit: `0c7bee0b8e2e44c580c8a6ac0ffb5800936e7687`
- Zeabur project: `69df815a554543d46b0f2485`
- service: `heavy-chain` (`6a318803302ffbcd03a92935`)
- environment: `69df815a5ae0a69725e92048`
- deployment: `6a86bb1d99ff31c1168ac1e7`, `planType=docker`, `status=RUNNING`
- runtime: `https://heavy-chain.zeabur.app/lightchain`, HTTP `200`

## Fresh Chrome Plugin/Profile 2 readback

- selector: `backend=chrome_plugin`, Profile 2,
  `signed_chrome_extension_profile2`, revision `6`
- fresh browser-client: `-71ca-47b6-96df-9ce84cf6c209`
- same-run `browsers.get()` and `user.openTabs()`: PASS
- task-owned provisioned tab: `1980904410`
- target URL: `https://heavy-chain.zeabur.app/lightchain`
- title: `Heavy Chain | AI制作ワークスペース`
- hydrated DOM: PASS
- owner lineage: current thread/session `01a01576-c224-7d81-902f-561719dc45a5`,
  turn `01a01e46-ac68-7cd0-af96-bd09d58b98f2`
- cleanup: `cleanup_verified=true`

## Production UI evidence

- Header: Lightchain AI / LIGHTCHAIN
- Hero: `LIGHTCHAIN AI` and `アパレル特化のAIデザインワークスペース`
- Prompt placeholder: `指示を入力してください... 例：『モデルの着せ替え』`
- Category tabs: おすすめ、企画デザインツール、AIフィッティング、グラフィックツール
- Recommended cards: 8 source-shaped cards, with the video card excluded from Heavy
- Case tabs: おすすめの事例、デザイン修正、柄・プリント、ビジュアル素材、
  マーケティングコンテンツ、生産

## Proof boundary

The live readback proves deployment/runtime and the visible non-video launcher
structure. It does not prove provider generation, save, Gallery/Canvas/History/Jobs
lineage, reuse/reload, real Mac/Windows acceptance, or internal beta acceptance.
No click, upload, rights confirmation, generation, save, recording, or foreground
operation was executed.

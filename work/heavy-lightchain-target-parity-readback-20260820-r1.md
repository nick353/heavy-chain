# Heavy / Lightchain target parity readback — 2026-08-20 r1

## Same-run read-only evidence

- backend: `chrome_plugin`
- selector: Profile 2 / `signed_chrome_extension_profile2` / revision `6`
- browser-client: `-79dc-4ed4-ab07-009281949b30`
- session boundary: `2f2487da-60e9-4441-a535-4829320589cd`
- owner lineage: current Goal thread and current turn
- `openTabs()` handshake: PASS, 8 tabs
- selected/focus/claim/foreground lease: not used

### Heavy

- target: `https://heavy-chain.zeabur.app/tools/fabric`
- task-owned tab: `1980903671`
- title: `Heavy Chain | AI制作ワークスペース`
- URL/title/DOM: PASS
- hydrated body length: `685`
- visible: Lightchain header/categories, 生地イメージ, library upload/Gallery selectors, textile and garment inputs, rights attestation, AI生成, 生成履歴
- cleanup: official task-owned cleanup `ok=true`

### Lightchain

- target: `https://jp.linkaigc.com/tools/fabric`
- task-owned tab: `1980903673`
- title: `Lightchain AI`
- URL/title/DOM: PASS
- hydrated body length: `315`
- visible: toolbar categories, 生地イメージ, プリントイメージ, legacy notice, reference-image inputs, image ratio, rights lock, 生成履歴
- cleanup: official task-owned cleanup `ok=true`

## Parity classification

- The legacy notice (`この機能はまもなく終了します` / `今すぐ体験`) exists on both screens; it is not Heavy-only chrome.
- Heavy's product-owned Gallery selectors, rights attestation, and AI generation gate are present for the internal all-user beta. These are required beta capabilities, not proof of provider completion.
- The direct route still differs in product title, toolbar wording, and detailed input composition. Because the requested target is a one-screen integrated internal workspace, these differences remain `PENDING_CONFIRMATION` until the full current Lightchain feature/input ledger and same-run interaction proof are completed.
- Lightchain's direct route currently exposes `権限がありません`; Heavy's beta-unlock route intentionally does not. This is an accepted internal-beta policy difference, not a reason to reintroduce the old lock.

## Boundary

This is target-scoped read-only DOM evidence only. It does not prove UI click behavior, rights confirmation, provider generation, result quality, save/reuse, Gallery/Canvas/History/Jobs persistence, retry/reload, or Mac/Windows real-Chrome acceptance.

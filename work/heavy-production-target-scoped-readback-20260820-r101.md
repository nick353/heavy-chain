# Heavy Chain production target-scoped readback r101

## result

The auth-lock fix from commit `4a1cce4` was deployed to the existing Heavy
Chain Zeabur service. Deployment `6a86c594488619a6c553f0f4` reached `RUNNING`.
A fresh official Chrome Plugin/Profile 2 browser-client then completed one
same-run `openTabs()` handshake and target-scoped `/tools/fabric` readback.

## selector and owner proof

- backend: `chrome_plugin`
- selector revision: `30`
- profile: `Profile 2` / `profile2`
- surface: `signed_chrome_extension_profile2`
- preflight: `status=ready`, `exact_blocker=null`
- browser-client: `-b911-45ef-a9a2-503edfc74eb7`
- session boundary: `b1dbd16b-e3a4-4c01-8924-7bedfa3df467`
- owner session/thread: `01a01576-c224-7d81-902f-561719dc45a5` /
  `01a01576-c224-7d81-902f-561719dc45a5`
- owner turn: `01a01e6d-2185-74c3-a42f-395ceb8c1b39`
- `openTabs()`: success, 2 tabs

The official advertisement still contains browser `viewport` and tab
`pageAssets`/`cdp`, but not `foreground_activation` or `management`.
`selected()`, focus, claim, and foreground lease were not used.

## target readback

`/tools/fabric` was absent from the fresh inventory. The allowlisted
target-scoped provisioning contract created task-owned tab `1980904546` and
read it in the same run.

- URL: `https://heavy-chain.zeabur.app/tools/fabric`
- title: `Heavy Chain | AI制作ワークスペース`
- `readyState`: `complete`
- hydrated controls: `生地イメージ`, model/design image input, fabric image input,
  keyword, ratio, fabric variants, `AI生成`, and `生成履歴`
- visible state: Lightchain-shaped fabric workbench; auth/workspace preparation
  shell is absent
- generation button: disabled until the two required images are supplied

## cleanup and boundary

- `cleanup_verified=true`
- only task-owned tab `1980904546` was closed
- existing tabs were untouched
- no login click, credential entry, upload, rights confirmation, provider
  generation, save, reuse, download, recording, AOS change, or external effect
  was executed

## blockers

- Authentication/workspace hydration is cleared by this fresh proof.
- Provider generation/save/reuse/reload remains `PENDING_CONFIRMATION` because
  the official signed extension does not advertise
  `foreground_activation`/`management`; exact blocker:
  `chrome_foreground_activation_capability_unavailable`.


# Chrome Plugin/Profile 2 capability + Heavy target-scoped readback r56

## result

- Current selector: `backend=chrome_plugin`, `Profile 2`, `signed_chrome_extension_profile2`, revision `4`.
- Fresh official browser-client: `-3c21-4cdb-ad2b-b76dfca619ca`.
- Same-run `openTabs()` succeeded. The browser advertised `viewport` only; `foreground_activation` and `management` were not advertised.
- The approved target-scoped lane was used for Heavy `/tools/fabric`, `/tools/printing`, and `/model`.
- Each route returned the expected Heavy URL/title and hydrated DOM with `readyState=complete`. Each provisioned task-owned tab was closed.
- `external_action_executed=false`.

## owner and proof boundary

- session/thread: `01a01576-c224-7d81-902f-561719dc45a5`
- turn: `01a01dab-63b8-7b03-883e-2035c6567e49`
- No `tabs.selected()`, focus, claim, foreground lease, authentication click/input, upload, provider generation, save, reuse, reload, recording, AOS change, or external effect was performed.

## Heavy route readback

| route | task-owned target | visible state | cleanup |
| --- | --- | --- | --- |
| `/tools/fabric` | `1980904297` | `生地イメージ`, two image inputs, `キーワード`, ratio, fabric variants, `AI生成`, `生成履歴` | PASS |
| `/tools/printing` | `1980904299` | `プリントイメージ`, `参考画像をアップロード`, `スポット`, `全体`, `AI生成`, `生成履歴`; persisted input/result state also showed `ベース画像`, `パターン参考`, result actions | PASS |
| `/model` | `1980904301` | `AIフィッティング`, `シングルタスク`, `マルチタスク`, clothing/reference/model-set inputs, `AI生成`, `生成履歴` | PASS |

## parity interpretation

The current Lightchain r54 readback showed an empty printing history and rights-locked fabric/model controls for that Lightchain account state. Heavy r56 showed its own persisted printing input/result state and beta-enabled fabric/model generation controls. This is a current state/authorization difference, not proof that a new Heavy-only visual component was added. Keep the persisted Gallery/History/Jobs continuity and internal-beta feature availability unless a same-account Lightchain entitlement readback requires a different contract. The difference remains `PENDING_CONFIRMATION` for exact account-state parity.

## remaining blocker

`chrome_foreground_activation_capability_unavailable`

The official signed Profile 2 distribution still does not advertise `foreground_activation` or `management`. Target-scoped read-only succeeded, but foreground-only provider generation and its same-run save/reuse/reload proof remain blocked.

## next action / restart point

- Next action: after the official capability or relevant authorization state changes, create a new Profile 2 browser-client and repeat the current selector advertisement → `openTabs()` → owner-lineage check once. If foreground capability is still absent, continue only with target-scoped read-only.
- Restart point: the first changed dependency followed by a fresh official owner. Do not reuse this browser id, task tabs, binding, or run.

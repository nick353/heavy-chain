# Heavy Chain — Light Chain完全一致に向けた引き継ぎ

作成日: 2026-10-06。ユーザー依頼でCodex側のGoalをPAUSEDに変更済み。ここからはClaude Code等の引き継ぎ先が、残作業を実装・検証して完成させるためのメモです。今回の引き継ぎでは新たな機能実装・生成・デプロイを行っていません。

## 最優先のユーザー指示

> 本家のライトチェーンに近づけるように、全く同じするように書いておいてください。

**本家Light Chainと同じ画面、操作の順番、入力、設定、選択肢、機能、出力の種類、保存・再読込・再利用、失敗時の挙動に揃えてください。近似UIや部分的な生成成功で完成としないでください。残作業は実施対象であり、提案書を作るだけで止めないでください。**

- 比較元は `https://jp.linkaigc.com`。Heavyは `https://heavy-chain.zeabur.app`。
- 同じviewport・同じページ・同じ状態で実物を比較する。余白、文字、アイコン、画像比率、カード、スクロール、hover/focus、ダイアログ、空状態、loading、失敗、保存済み状態まで対象にする。
- 本家にない入力項目、同意、登録ステップ、説明、無意味なクリックを追加して一致したことにしない。機能ごとの専用フォームと遷移を維持し、汎用生成フォームへの置換で済ませない。
- Heavyの独立したアプリ・認証・保存先・実際のProvider接続を保ちながら、ユーザーが使う画面と動作を本家に揃える。名称やブランドの既存差異も差分台帳に明記し、未承認の差異を暗黙に許容しない。
- 本家で未取得・未確認の画面や動作は「未確認」とする。推測で完全一致を主張しない。
- 従来の内部betaでは動画、課金、一般公開、monitor credential provisioning、販売は対象外だった。本家全体との完全一致を主張する時はこれらの差分も残し、以前の除外だけで全体完成としない。旧範囲を完了する作業と追加範囲の実装・外部操作を区別する。

## 読む順番と正本

1. このメモとルート `HANDOFF.md`。`CLAUDE.md`もこのメモへの入口。
2. `docs/handoff/production-baseline-20261006.json` — 停止時点の本番、検証済み範囲、未受入、cleanup。
3. `docs/handoff/production-input-manifest-20261006.json` と `production-source-overlay-20261006.patch` — 本番ソースを再構成するための境界。
4. `src/lib/lightchainParityCatalog.ts`、`src/App.tsx`、各専用ページと対応テスト — 現在の機能・route実装。
5. `STATE.md` / `GOAL.md` — 詳細な過去経緯。大量の履歴と古いactive・承認・blocker記述が混在するため、現在状態の代わりに使わない。

ローカル正本repo: `/Users/nichikatanaka/Documents/Codex/external-repos/heavy-chain`。
この作業のローカル証拠: `/Users/nichikatanaka/Documents/Codex/2026-10-04/heavy-chain/outputs` とrepoの `work/`。
元の全体計画: `/Users/nichikatanaka/Documents/Codex/2026-10-01/task-5/HEAVY_CHAIN_FULL_SCOPE_PLAN.md`。
これらのローカル絶対パス、ログ、認証状態、IndexedDB、画像バックアップはクラウド側に自動転送されません。GitHubの可搬メモを起点にし、必要な証拠が手元にない項目は未確認として残してください。認証情報や個人画像を公開GitHubへ追加しないでください。

## 現在の本番とWIPソースの違い

| 項目 | 停止時点の状態 |
|---|---|
| 本番Web | `https://heavy-chain.zeabur.app` |
| API | `https://heavy-chain-api.nichika2000823.workers.dev` |
| 最新Web deployment | `6ac4daea4a4c47e13ede3f11` / docker / RUNNINGを確認済み |
| 最新変更 | Libraryのボードコピー→明示Canvasペースト、カード操作ボタンの視認性修正 |
| 本番packet SHA256 | `ede8b9b93942cf4d4530b60c84130339b1023cba72042a83df8758da40eaef8b` |
| release context SHA256 | `f0048c19fbb01ea2b1cf785238e62adb49a954491d0d44602775166a0f097c2e` |
| 本番frontend入力 | manifestの360ファイル。チェックポイントとは10ファイルが異なる |
| canonical Canvas | clipboard変更に加えてprotected/source-promotion等の未反映変更を保持。これをそのまま本番版と見なさない |
| Worker / migration | `cloudflare/heavy-api`の変更、`0015`等の追加はローカルWIP。本引き継ぎでWorker・D1 migrationをdeployしていない |
| 全体検証 | frozen candidateの関連103テスト・型チェック・buildは通過。canonical全体の最新フルsuite通過を主張していない |
| 本番配信ファイル | 最新asset名は観測済み。最新全artifactをnative downloadしてhash一致させる確認は未完了 |
| 全体受入 | 元20項目 / strict31行の全面受入は未完了。strict31行の完全受入は0行という境界を維持 |

現在の本番と異なる10ファイルはportable JSONに列挙済みです。差分patchは **チェックポイント → 現在の本番ソース** の向きです。既存作業を消すためにworking treeへ適用しないでください。本番baselineの調査・再現が必要な場合だけ、別のディレクトリでmanifestの360ファイルをコピーしてpatchを適用し、全ファイルのSHA256を照合してください。manifest外のpendingコードは本番source集合に含めません。

本番buildの公開設定はportable JSONに保存した5項目です。`VITE_GENERATION_PROVIDER=workers_ai`という互換adapter名だけで実画像Providerを判定しないでください。Heavyの実画像ProviderはOpenAIとして維持されており、コード・Provider receiptで確認します。秘密鍵をVITE変数へ入れないでください。

## 直近で進んだことと、その限界

| 作業 | 確認済み | まだ満たしていない条件 |
|---|---|---|
| Library→Canvasコピー | 本家の実callbackがclipboardへの参照書込みであることを確認。Heavyもscope付き参照コピーへ変更。Library内49件を増減させず、画面遷移なし。明示Meta+Vを一度実行して同じsourceの1要素だけ追加 | Windows Ctrl+V、remote card側、全viewport/全状態、本家との全UI一致、保存・再読込後の同一document再利用 |
| コピー操作の視認性 | 714pxの実画面で32px操作が見え、実際にコピー可能になった | 1280〜2560px実環境、hover/focus等の全状態比較 |
| コピー検証cleanup | task追加object `ye3wyyxl7xa`だけを一度削除。元 `w13mb2h10wh` / `mu3keorhdms`のID・geometry・zoom1/pan0をdebug readbackで確認。新生成・Canvasサーバー保存は未実行 | 元Canvasの旧操作正式精算と同document保存・reload・reuse。今回cleanupで代替しない |
| printing入力の保持 | passive loadがrich draftをcompact draftで上書きしない。coverage更新で6layers/process/masks/manualplanesを維持。source identity回帰検証済み | fabric/printing全設定・元入力・全成果の機能別受入、歴史的Sep29元printingの復元 |
| printing safety copy | 実draftの同ブラウザIndexedDBコピー、Library入力→draft保存→新tab/reloadで復元、元default raw metadata/bytes復元を確認。関連122テスト・型/build通過 | 端末外バックアップではない。全printing機能の完成ではない |
| 静的asset cache | hashed JS/CSS immutable、HTML no-cache、missing fallback no-cache、auth JSON no-store。実HTTP7テスト。47assetsのwarm transfer 1,916,759→0 | ページ全体・Providerを含む性能の本家比較 |
| History / Jobs | opt-in all-loaded表示でlegacy cutoffを修正し、元IDを実画面で確認 | 全31行の同run四面・fresh D1/private-R2証明 |
| custom model | 最新custom resultの全身構図、元入力設定、Gallery/History/Jobs/reload同tupleを確認 | 他のモデル機能の代替ではない。fresh D1/full31受入、体形cmの実測品質は未確認 |
| vector | normal/proの既存結果のGallery/Provider/reload/private PNG同一性を確認 | 本来必要なSVG/ベクター形式、source fidelity、設定復元、Canvas、failure/retry、fresh D1 |

追加した主要ファイルは `src/lib/libraryCanvasClipboard.ts` と `scripts/verify-library-board-clipboard.test.ts`。実callerは `src/pages/LightchainLibraryPage.tsx`、`src/pages/CanvasEditorPage.tsx`、視認性は `src/index.css`。前者の参照形式は `heavy-library-canvas:v1:`、scopeはorigin/user/brand、sourceはartifactまたはgenerated-imageのIDです。画像bytes・signed URLはclipboardに入れず、文書/scope切替をawaitの各段階で検出し、入力欄で通常の文字貼付けを妨げない設計です。

## 実行する優先順と完了条件

| 順番 | やること | 完了条件 |
|---|---|---|
| P0 | このブランチでsourceを再現し、canonical WIPと本番baselineを区別する。missing依存・コンパイル・重要回帰を直す | 新環境で必要な依存と設定を揃え、関連テスト・型/buildを通す。本番360ファイルhashと10差分、pending Worker/migrationを説明できる。認証・個人画像なしで再現可能 |
| P1 | 本家全route/全状態の比較台帳を作り、現在sourceとの実差分を一件ずつ修正する | 全画面・全機能について同viewportの本家/Heavy証拠、差分、修正、再検証がある。未取得・未対応・意図的差異を欠落させない。未承認の見た目・操作差分が残れば未完了 |
| P2 | 元20項目・31行の不足を閉じる。既存成果を再利用し、入力/出力の保存復元・専用フォーム・機能固有仕様を完成させる | 各行の専用条件と下記共通受入条件を満たす。生成成功だけで完了行へ変更しない |
| P3 | 正規権限がある環境で同run Provider/D1/private-R2、四面、failure/recoveryを照合する。旧unknownは同じ操作の正式証拠で精算する | request/job/image/path/bytes/settingsの対応が曖昧でなく、定義した再開条件で重複生成/保存がない。既存権限エラーを迂回しない |
| P4 | 実Mac/Windows・1280〜2560px、品質、性能、internal operatorの受入を行い、重大不具合を修正する | 全必須workflowが実環境で完走し、出力品質・操作性・速度の条件を満たし、利用者が手助けなしで作業できる |
| P5 | 現行source/release/evidenceを揃え、残差分・未精算・cleanupを最終確認する | 元20項目と31行の全必須列に証拠があり、本家完全一致の未解消差分を明記。必要な未精算/重大不具合があれば完成扱いしない |

P1/P2のローカル実装や独立した確認は、D1管理権限や旧unknownの解決待ちで一律停止しないでください。依存する一項目だけを保留し、他を進めてください。

## 元の20項目 — 残作業と個別完了条件

| No. | 残作業 | 完了条件 |
|---|---|---|
| 1 | Studioの元操作を正式に精算 | 元operation/capsule/receiptの効果と保存先を同一操作で確定。別の成功runで代用しない |
| 2 | Studio pendingACKのfull-page reload復元 | 同document/request/imageを復元し、二重生成・保存なし。破損/foreign scopeで安全に止まる |
| 3 | 元Canvas2要素の保存・reload・reuse | 旧操作精算後に元2要素のID、位置、geometry、zoom/pan、同documentが保存前後/再利用で一致 |
| 4 | Fitting単体の専用入力と結果再利用 | clothing/model/settingsから実行し、四面同一出力、reload、同設定の再利用が一致 |
| 5 | Fitting batchの実動作 | max8受入/9rejectに加え、各input→output対応、保存、部分失敗、復旧が実画面で正しい。二重実行なし |
| 6 | fabric/printingの元input・順序・配置・設定 | 元source/bytes/order/placement/settingsが復元され、出力の同ID四面/reload/reuseが一致 |
| 7 | Libraryの各種入力復元 | clothing/model/fabric/print/reference/過去outputのsource ID・bytes・settings・owner scopeが利用先まで維持 |
| 8 | Designの会話・編集workflow | 会話文脈、reference、layers、adoption、失敗復旧、reloadが一致し、重複実行なし |
| 9 | Wear/Labのhome→detail→edit | 正しい詳細へ遷移し、元結果を保持して編集成果を別保存、reload。欠損inputは正しく表示 |
| 10 | モデル個別機能のフォーム・復元 | face/model/body/size/pose/background/angle/customを個別に受入。generic model matrixの成功で代用しない |
| 11 | 残31機能の機能固有条件 | marketing、line、repair、color、vector等で専用input/setting/output形式/復元を本家に合わせる |
| 12 | 同run四面と実保存identity | Gallery/Canvas/History/JobsおよびProvider/D1/private-R2のrequest/job/image/path、data、statusが同じrunで一致 |
| 13 | 失敗・retry・reload | stageごとの確定失敗と再開を実証。unknown effectの再送なし。重複generation/persistenceなし |
| 14 | 本家全UI/state一致 | 同viewport・同状態で全route/全操作を比較。未承認の余計なステップ/差分を解消し、未取得状態を隠さない |
| 15 | logout/loginで同workspace復元 | 認証を跨いでも正しいowner/brand/workspace/outputが復元され、foreign scope流入/二重生成なし |
| 16 | 実画像の原寸品質 | clothing fidelity、printing、composition、artifact、業務用途を機能別rubricで確認。thumbnailだけで判定しない |
| 17 | 本家との同環境速度比較 | UI時間とProvider時間を分けて測る。従来のUI約10%以内の差目標を検証し、遅い経路を修正 |
| 18 | 実Mac/Windows Chrome | 1280〜2560pxでupload/save/reuse/exportと主要workflowが完走し、重大な操作不能・崩れなし |
| 19 | internal operator受入 | 本人以外の実利用者が手助けなしで必須タスクを完遂。feedbackと重大修正後の再受入を記録 |
| 20 | 最終版review・精算・cleanup | current sourceと配信版を対応づけ、pending操作/所有resources/差分を精算し、全条件の根拠を説明可能 |

## strict31機能 — 残りをすべて実施する

共通完了条件: (a) 本家の専用画面・操作・入力設定と一致、(b) 元input ID/bytes/settings/scopeを維持、(c) 同run request/job/image/pathのProvider/D1/private-R2照合、(d) Gallery/Canvas/History/Jobsの必要四面、(e) reload/reuse、(f) 確定失敗/recoveryとunknown no-replay、(g) 実原寸品質。行ごとの対象仕様に合わせて適用し、該当しない列は理由と本家根拠を記録してください。共通成功例を31行へコピーしないでください。

旧台帳では30機能に生成履歴があり、custom-styleは非生成UI確認の段階でした。履歴を再利用し、足りない条件を閉じてください。現時点では完全受入0/31という境界です。

| feature | 個別に残る主な作業 | その行の完了条件 |
|---|---|---|
| marketing-home | homeの専用workflowと失敗復旧、実保存証拠を補う | 共通条件＋home入力/成果の同run復元 |
| marketing-detail | 詳細の設定/元成果/四面・失敗を照合 | 共通条件＋detail固有設定をreload/reuse |
| fitting-clothing-reference | clothing referenceの復元と失敗境界 | 共通条件＋選択衣服referenceのidentity/設定維持 |
| fitting-background-reference | background referenceの個別受入 | 共通条件＋同じbackground inputと設定を復元 |
| wear-design-lab | LabとWear detailを混同せず専用homeを受入 | 共通条件＋正しいhome→detailの対応 |
| wear-design-detail | 原寸品質、元inputに基づくedit、失敗を補う | 共通条件＋元成果を消さず編集成果別保存。旧403を迂回しない |
| fashion-studio | 元ACK、専用hydration、viewport、復旧 | 元20項目1/2と共通条件。新runで旧操作を代用しない |
| design-agent | 会話文脈/reference/layers/adoption/failure | 共通条件＋会話・採用状態と文書を復元 |
| lab | canonical home/detail/edit/reloadを現行版で確認 | 共通条件＋元/編集成果を別保持 |
| print-design-project | project入力・成果・historyを復元 | 共通条件＋project IDと元draftの関係維持 |
| print-design-detail | detailとprintingへの受渡しを仕上げる | 共通条件＋layer/process/配置設定を維持 |
| fabric-image | 元fabric設定、保存復元、四面を個別受入 | 共通条件＋元生地/素材bytesと設定一致 |
| line-generation | 専用線画生成と保存/reuse/失敗 | 共通条件＋専用線画設定と出力品質 |
| line-to-real | 線画sourceを実inputとして保持、写実成果を評価 | 共通条件＋元線画と写真化outputの対応/復元 |
| pattern-vector | ベクター形式とsource fidelity、Canvas/復元 | 共通条件＋本家が要求する実vector/SVG形式。PNG保存だけで完了しない |
| pattern-vector-pro | pro固有設定・出力形式を検証 | 共通条件＋pro固有動作/設定/形式をnormalと区別 |
| printing-image | 元draft/入力/配置、原寸品質、再利用 | 共通条件＋複数layers/masks/manualplanes等を欠損なく保持 |
| image-repair | 修復対象・保護領域、実output、復旧 | 共通条件＋修復領域のみ変更し元source/settings保持 |
| svg-convert | 本来のSVG変換を実ファイルで確認 | 共通条件＋正しいSVG構造/形式/原図再現。画像拡張子変更で代用しない |
| custom-style | 「未学習」、連絡/保存error、学習状態identity | 本家の作成/学習/保存/利用のstate遷移を個別実証。生成historyがないまま受入しない |
| ai-fitting | 個別input/result、同document recovery | 共通条件＋専用Fitting設定と同document再利用 |
| ai-fitting-reference | alias/reference modeの対応 | 共通条件＋mode/reference/sourceがreload後も一致 |
| model-library | 元と最新の設定復元、library個別受入 | 共通条件＋選択modelと元設定を復元。欠損inputをdefaultで偽装しない |
| model-face | face専用入力/設定/品質を受入 | 共通条件＋顔referenceと専用編集結果の対応 |
| model-change | model専用フォーム/設定/保持 | 共通条件＋選択model・衣服等の機能固有保持 |
| body-shape | 個別体形設定と結果品質を確認 | 共通条件＋指定体形の復元/効果。custom modelで代用しない |
| clothing-size | size専用設定とサイズ変更品質 | 共通条件＋サイズ条件と衣服sourceを保持 |
| pose-change | 元操作を精算し、pose専用復元/品質 | 共通条件＋pose設定/出力対応。旧unknownを再クリックしない |
| background-change | 専用background入力/設定/品質 | 共通条件＋背景を変えて保持対象を維持 |
| angle-change | angle専用復元/品質と旧unknown精算 | 共通条件＋angle条件対応。旧back操作の再送禁止 |
| model-custom | 最新全身成果に不足証拠を追加 | 共通条件＋height/measurements/similarity/prompt等の実設定復元・原寸品質 |

## 結果不明の旧操作と権限blocker

これらは別操作の成功、現在のbackup、ローカルテストで精算しないでください。古いownerの再起動、メッセージによる承認転送、別tab/別surface/別keyでの再送を行わず、元操作の正規readback/receiptと適切な権限を再開条件にします。独立したsource修正まで止める必要はありません。

| 対象 | exact blocker / 状態 | 再開条件・禁止すること |
|---|---|---|
| Cloudflare管理 | Worker `heavy-chain-api`。D1 CLI7403、private R2管理403/10000。appの認証済みGETは利用可能だった | 正規account/権限が利用可能な環境で同run独立readback。credential probeの反復、rotation、別surfaceによる迂回をしない |
| 元Canvas | owner `01a0f287-ff0a-7450-8b74-fe48298eef6a`。旧op `8d517…` / capsule `75b7…` / run `heavy-canvas-identity-production-r1008` / key `r1046-navonce` / 元tab3728。retry false | 元owner-bound receiptと同document保存先を正式に精算。元2要素を別document/別runで置換しない |
| 元Studio | owner `01a1012e-a0ad-7483-a7ae-6c3728397ebc`。STOPPED_HANDOFF / pendingACK v4 / op `5dbd…` / capsule `d371…`。retry false | 同operationのACK・effect・保存を確定。元ownerを勝手に再開/送信しない |
| 旧Light viewport | tab1980935548 / op `2d00…` / run `heavy-light-model-desktop-20261005` / key `light-model-1280-set-once:1` / capsule `14591a…` | `viewport_cleanup_target_mismatch`。adopt/reopen/replay/close/clear/旧override再適用禁止。現在session close後もこの古いtabだけretained |
| 元Pose Library | op `138c0039…` / capsule `f8b…`、元tab7072なし。completedとcontinuation falseの不整合、retry false | 正式receiptで状態を確定。元クリックの再送なし |
| 元Wear R07 | request `ebabfa02…` / image0。旧download403、owner completed | 正規原寸アクセスと元job証拠。旧downloadを再送せずLab成果で代用しない |
| 旧Angle back | op `9f4af66c…` / capsule `85d29…`。unknown/noReplay、tab disposed | 元receiptで精算。backの再送禁止 |
| protected19 / Worker | 統合offline candidate未deploy。canonicalにpending変更あり | 差分ごとのsource/回帰/実受入を通して反映範囲を限定。buildがgreenというだけで全変更を一括deployしない |

署名付きcapsule、認証token、個人画像、完全なprivate owner scopeはこの公開GitHubメモに含めていません。元操作の完全IDはローカルreceiptにあります。短縮IDだけから再実行用のauthorityを作らないでください。

## 検証の進め方

- ローカルfrontend: `npm ci`、`npx tsc -b`、`npm run build`。これらは外部生成・deployではありません。Nodeは停止時点でv26.3.0。strip-typesを使うテストがあるため対応Nodeを使う。
- Library clipboard回帰: `node --experimental-strip-types --test scripts/verify-library-board-clipboard.test.ts scripts/verify-library-canvas-handoff.test.ts`。
- printing/input回帰: `node --experimental-strip-types --test scripts/verify-printing-library-draft-precedence.test.mjs scripts/verify-print-input-artifacts-runtime.test.ts scripts/verify-canvas-local-draft-readback.test.mjs scripts/verify-cloudflare-image-pending-store.test.mjs`。変更の影響に合うテストを選ぶ。
- Worker変更は `cloudflare/heavy-api/package.json` のtypecheck/testを別に実行。runtime/submit/deploy/migration系のcommandを単純なunit testとして実行しない。
- UI操作はユーザー指定のAOS Chrome Companion拡張を使い、own session/exact tabでsemantic＋native screenshot、1回の操作、結果readback、own cleanupを行う。クラウド環境でこのsurface・認証がない場合、ローカル実装を進めてnative受入だけ保留する。
- source/probe中にあるPlaywright/raw DOM/旧browser経路を、そのまま本番操作の許可と解釈しない。既存unknownに別surfaceを使わない。
- 既存成果と合格済みの根拠を再利用する。新しい差分や未解決条件がない同じテスト/資料読込の反復は進捗に数えない。
- local tests、health、queued、クリック、deployment RUNNING、画像表示を業務受入の代わりにしない。結果は「変更／検証／残blocker／次の作業」で記録する。

## 引き継ぎ先への実行指示

このチェックポイントから残作業を実際に進めてください。最初に本番baselineとWIPを区別し、本家Light Chainの実UI/動作を正本として差分を修正します。元20項目とstrict31行の完了条件を一件ずつ閉じ、各行にsource版・本番版・証拠・未確認条件を残してください。完成を妨げる条件が解消されていない間は完成と言わず、独立して進められる作業を続けてください。Codexの停止済みGoalや旧owner操作を再開する必要はありません。

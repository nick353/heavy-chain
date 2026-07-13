# Heavy Chain 要件定義書

## 1. プロジェクト概要

### 1.1 サービス名
**Heavy Chain**

### 1.2 サービス概要
AI（Gemini NanoBanana Pro + OpenAI）を活用したアパレル向け画像生成プラットフォーム。マーケティング、商品企画、EC、編集ユーティリティなど、アパレルビジネスに必要な画像生成・編集機能をワンストップで提供。

### 1.3 ターゲットユーザー
- アパレルブランドの社内デザインチーム（BtoB）
- フリーランスのファッションデザイナー（BtoC）
- ECサイト運営者（商品画像量産目的）

### 1.4 ビジネスモデル
- **フリーミアム方式**
- 初期フェーズ：全機能無料開放（ユーザー獲得優先）
- 将来：有料プラン導入＋機能制限

---

## 2. 技術スタック

| レイヤー | 技術 |
|---------|------|
| フロントエンド | React + Vite + Tailwind CSS |
| バックエンド | Supabase（認証・DB・ストレージ・Edge Functions） |
| AI画像生成 | Gemini NanoBanana Pro（メイン）|
| AIテキスト処理 | OpenAI GPT-4（プロンプト最適化・翻訳） |
| 決済 | Stripe |
| ホスティング | Vercel or Cloudflare Pages（予定） |
| キャンバスUI | Konva.js + react-konva（2Dキャンバス操作） |
| ノードグラフ | React Flow（派生ツリー表示・ベジェ曲線接続） |
| リアルタイム同期 | Yjs + Supabase Realtime（CRDT同期） |
| 履歴管理 | Yjs UndoManager（操作履歴・巻き戻し） |

### 2.1 APIキー管理
- サーバーサイド（Supabase Edge Functions）で一括管理
- ユーザー持ち込みオプションは提供しない

---

## 3. 認証・アカウント

### 3.1 認証方法（Supabase Auth）
- メール/パスワード
- Google OAuth
- Apple OAuth

### 3.2 アカウント機能
- プロフィール設定（名前、アバター、言語設定）
- パスワードリセット
- アカウント削除

---

## 4. ブランド/プロジェクト管理

### 4.1 マルチブランド対応
- 1ユーザーが複数ブランドを作成・管理可能
- ブランド切り替えUI

### 4.2 ブランドプロファイル
各ブランドに保存可能な情報：
- ブランド名
- ロゴ画像
- ブランドカラー（プライマリ/セカンダリ）
- 世界観・トーン説明文
- ターゲット層
- デフォルトスタイルプリセット

### 4.3 チーム機能

#### 権限レベル（4段階）
| 権限 | 説明 |
|------|------|
| オーナー | 全権限、ブランド削除、メンバー管理、課金管理 |
| 管理者 | メンバー招待/削除、全機能利用、設定変更 |
| 編集者 | 画像生成・編集、アセット管理 |
| 閲覧者 | 閲覧のみ、ダウンロード可 |

#### 招待方法
- メール招待リンク
- 招待コード（有効期限付き）

---

## 5. 機能一覧

### 5.1 マーケティング・SNS系

| 機能 | 説明 | APIモード |
|------|------|----------|
| キャンペーン画像自動生成 | 季節・セール情報からSNS向け画像を生成 | Text-to-Image |
| テキスト入り広告バナー | キャッチコピー埋め込みバナー生成 | Text-to-Image（テキストレンダリング） |
| シーン別コーディネート | 同商品を複数シーン（カフェ、ストリート等）で生成 | Text-to-Image |
| SNSフォーマット自動リサイズ | Instagram/X/TikTok向けアスペクト比対応 | Text-to-Image / Image+Text |

### 5.2 商品企画・デザイン系

| 機能 | 説明 | APIモード |
|------|------|----------|
| カラバリ・柄モックアップ | 色違い・柄違いバリエーション生成 | Text-to-Image / Image+Text |
| 素材感シミュレーション | シルク、コットン等の質感変更 | Image+Text |
| コーディネートテスター | 新作と既存アイテムの組み合わせ確認 | Text-to-Image |
| シーズンルックブック | 抽象コンセプトからビジュアル生成 | Text-to-Image |
| デザイン比較ボード | 複数案を並べて比較 | UI機能 |

### 5.3 EC系

| 機能 | 説明 | APIモード |
|------|------|----------|
| 商品ページ標準カット | 正面/側面/背面/ディテールの自動生成 | Text-to-Image |
| ライフスタイルカット | 使用シーン付き商品画像 | Text-to-Image / Multi-Image |
| 体型・年齢違い着用イメージ | S/M/L、20代/30代/40代マトリクス生成 | Text-to-Image |
| 多言語ECバナー | 日/英/中/韓テキスト入りバナー | Text-to-Image |
| 先行予約イメージ | 実物なしでコンセプト画像生成 | Text-to-Image / Image+Text |

### 5.4 編集・ユーティリティ系

| 機能 | 説明 | APIモード |
|------|------|----------|
| 背景削除・差し替え | 白背景化、シーン背景合成 | Image+Text |
| アップスケール＆品質改善 | 高解像度再生成 | Image+Text |
| 小さな修正 | シワ除去、ゴミ消し、レタッチ | Image+Text |
| マスコット・フィギュア生成 | ブランドロゴからキャラクター生成 | Text-to-Image / Multi-Image |

### 5.5 ワークフロー系

| 機能 | 説明 |
|------|------|
| プロンプト最適化エンジン | 日本語→英語プロンプト変換（OpenAI経由） |
| デザインガチャ | 1ブリーフから複数方向性（ミニマル/ポップ/サイバー等）生成 |
| チャットベース逐次編集 | 対話形式で「もっと明るく」「ズームアウト」等の編集 |
| スタイルプリセット | 再利用可能なスタイル設定の保存・適用 |

---

## 6. 画像管理機能

### 6.1 保存・整理
- 生成履歴保存期間：**30日**
- フォルダ機能（階層管理）
- タグ付け機能（複数タグ可）
- お気に入り/ピン留め

### 6.2 バージョン管理
- 編集前→編集後の履歴保持
- 任意のバージョンに戻る機能

### 6.3 エクスポート
- 個別ダウンロード（PNG/JPEG/WebP）
- 一括ダウンロード（ZIP）
- 共有リンク生成（有効期限設定可）

---

## 7. UI/UX設計

### 7.1 デザインコンセプト
**ミニマル × ラグジュアリー × Canvaライク**
- 無駄を削ぎ落としたクリーンなUI
- 上質感のあるタイポグラフィ・余白設計
- ダークモード対応
- フリーキャンバスによる直感的な操作体験

### 7.2 フリーキャンバスUI

#### 7.2.1 キャンバス基本操作
- **無限キャンバス**：制限なく広がるワークスペース
- **ズーム**：マウスホイールで拡大縮小
- **パン**：ドラッグで視点移動
- **グリッド表示**：オン/オフ切り替え可能
- **ガイドライン**：スナップ機能でオブジェクト整列
- **ミニマップ**：右下に全体俯瞰ビュー表示

#### 7.2.2 オブジェクト操作
- **ドラッグ&ドロップ**：画像・テキスト・シェイプを自由配置
- **リサイズ**：四隅/辺のハンドルでサイズ変更
- **回転**：回転ハンドルで角度調整
- **レイヤー管理**：オブジェクトの重なり順変更
- **グループ化**：複数オブジェクトをまとめて操作

#### 7.2.3 派生ツリービュー（ノードグラフ）
画像生成・編集の履歴を視覚的なツリーで表示：
- **接続線**：ベジェ曲線（Figma/Miroスタイル）
- **自動配置**：派生すると自動で横に並ぶ
- **手動調整**：自動配置後に自由に移動可能
- **折りたたみ/展開**：ノード群の表示切り替え

```
[元画像A] ──曲線──▶ [背景削除B] ──曲線──▶ [カラバリC1]
                                   ├──曲線──▶ [カラバリC2]
                                   └──曲線──▶ [カラバリC3]
```

#### 7.2.4 フローティングツールバー
オブジェクト選択時に表示されるコンテキストツールバー：
- **位置**：選択オブジェクトの上部に表示
- **主要アクション**：背景削除、カラバリ、アップスケール等
- **その他メニュー**：「...」から全機能アクセス
- **クイック操作**：複製、削除、ダウンロード

#### 7.2.5 オブジェクト追加
キャンバスに追加可能な要素：
- **画像**：生成画像、アップロード画像
- **テキスト**：自由テキスト、スタイル設定可
- **シェイプ**：矩形、円、線、矢印
- **フレーム**：クリッピングマスク用

### 7.3 アートボード/出力設定

#### 7.3.1 アートボード
- キャンバス上に複数のアートボードを配置可能
- 各アートボードは独立した出力サイズを持つ

#### 7.3.2 サイズテンプレート
| プラットフォーム | サイズ |
|-----------------|--------|
| Instagram投稿 | 1080×1080 |
| Instagramストーリー | 1080×1920 |
| X/Twitter投稿 | 1200×675 |
| TikTok | 1080×1920 |
| ECサムネイル（汎用） | 1000×1000 |
| バナー（横長） | 1920×600 |
| カスタム | 自由設定 |

### 7.4 デザインテンプレート
レイアウト済みのテンプレート：
- **SNSバナー**：テキスト+画像配置済み
- **セールバナー**：プロモーション用
- **ルックブック**：複数商品レイアウト
- **商品紹介カード**：EC用テンプレート
- **季節キャンペーン**：春夏秋冬テーマ

### 7.5 リアルタイム共同編集

#### 7.5.1 同期技術
- **Yjs（CRDT）**：コンフリクトフリーのリアルタイム同期
- **Supabase Realtime**：WebSocketによる低遅延通信
- **同時編集人数**：無制限

#### 7.5.2 プレゼンス表示
- **カーソル共有**：他ユーザーのカーソル位置をリアルタイム表示
- **選択範囲表示**：他ユーザーが選択中のオブジェクトをハイライト
- **ユーザーアバター**：編集中ユーザーをキャンバス上に表示
- **オンラインステータス**：参加中メンバーのリスト表示

#### 7.5.3 変更履歴・ロールバック
- **操作ログ**：誰が・いつ・何を変更したかを記録
- **Undo/Redo**：Ctrl+Z / Ctrl+Shift+Z で個人操作の取り消し
- **バージョンスナップショット**：任意のタイミングで保存
- **ロールバック**：特定の変更時点に巻き戻し可能
- **変更差分表示**：バージョン間の違いをビジュアル表示

### 7.6 出力・書き出し

#### 7.6.1 個別書き出し
- **選択画像単体**：PNG/JPEG/WebP形式
- **アートボード**：設定サイズでクロップして出力

#### 7.6.2 一括書き出し
- **派生ツリーまるごと**：選択ノードから派生した全画像をZIP
- **フォルダ構造維持**：派生関係をフォルダ階層で表現

### 7.7 操作モード
- **フォームベース**：項目入力型（初心者向け）- サイドパネル
- **チャットベース**：対話型逐次編集（上級者向け）- サイドパネル
- 機能によって最適なモードを提供

### 7.8 レスポンシブ対応
- デスクトップ優先設計（フルキャンバス体験）
- タブレット：タッチ操作対応、簡略化UI
- スマートフォン：閲覧・軽微な編集向け
- 将来：ネイティブアプリ（iOS/Android）検討

---

## 8. 多言語対応

### 8.1 対応言語
- 日本語（デフォルト）
- 英語
- 中国語（簡体字）
- 韓国語

### 8.2 実装方式
- i18nライブラリ使用（react-i18next等）
- 言語ファイルによる管理
- ユーザー設定で切り替え

---

## 9. 外部連携

### 9.1 ECプラットフォーム
| プラットフォーム | 連携内容 |
|-----------------|---------|
| Shopify | 商品画像自動アップロード、商品情報取得 |
| BASE | 商品画像自動アップロード |
| STORES | 商品画像自動アップロード |

### 9.2 クラウドストレージ
| サービス | 連携内容 |
|---------|---------|
| Google Drive | 画像エクスポート、フォルダ同期 |
| Dropbox | 画像エクスポート |

### 9.3 デザインツール
| サービス | 連携内容 |
|---------|---------|
| Figma | 画像エクスポート（プラグイン経由） |
| Canva | 画像エクスポート |

---

## 10. 管理者機能（Admin Dashboard）

### 10.1 ユーザー管理
- ユーザー一覧・検索
- アカウント詳細閲覧
- アカウント停止/復活
- プラン手動変更

### 10.2 アナリティクス
- アクティブユーザー数（DAU/MAU）
- 機能別利用状況
- 生成画像数推移
- 人気機能ランキング

### 10.3 コスト管理
- API使用量モニタリング（OpenAI/Gemini）
- 月別コスト推移
- ユーザー別使用量

### 10.4 コンテンツモデレーション
- 不適切画像の自動検出フラグ
- 手動レビューキュー
- コンテンツ削除機能

### 10.5 お知らせ配信
- システム通知作成・配信
- メンテナンス告知
- 新機能リリース通知

---

## 11. データベース設計（概要）

### 主要テーブル
```
users
├── id (UUID)
├── email
├── name
├── avatar_url
├── language
├── created_at

brands
├── id (UUID)
├── owner_id (FK: users)
├── name
├── logo_url
├── brand_colors (JSONB)
├── tone_description
├── target_audience
├── created_at

brand_members
├── brand_id (FK: brands)
├── user_id (FK: users)
├── role (owner/admin/editor/viewer)
├── invited_at
├── joined_at

invitations
├── id (UUID)
├── brand_id (FK: brands)
├── email (nullable)
├── code
├── role
├── expires_at
├── used_at

generation_jobs
├── id (UUID)
├── brand_id (FK: brands)
├── user_id (FK: users)
├── feature_type
├── input_params (JSONB)
├── optimized_prompt
├── status (pending/processing/completed/failed)
├── created_at
├── completed_at

generated_images
├── id (UUID)
├── job_id (FK: generation_jobs)
├── storage_path
├── thumbnail_path
├── version
├── parent_image_id (FK: self, nullable)
├── created_at
├── expires_at

folders
├── id (UUID)
├── brand_id (FK: brands)
├── parent_folder_id (FK: self, nullable)
├── name

image_folders
├── image_id (FK: generated_images)
├── folder_id (FK: folders)

tags
├── id (UUID)
├── brand_id (FK: brands)
├── name

image_tags
├── image_id (FK: generated_images)
├── tag_id (FK: tags)

favorites
├── user_id (FK: users)
├── image_id (FK: generated_images)

share_links
├── id (UUID)
├── image_id (FK: generated_images)
├── token
├── expires_at
├── created_by (FK: users)

style_presets
├── id (UUID)
├── brand_id (FK: brands)
├── name
├── prompt_template
├── settings (JSONB)

api_usage_logs
├── id (UUID)
├── user_id (FK: users)
├── brand_id (FK: brands)
├── provider (openai/gemini)
├── tokens_used
├── cost_usd
├── created_at

admin_announcements
├── id (UUID)
├── title
├── content
├── type (info/warning/maintenance)
├── published_at
├── expires_at

canvas_projects
├── id (UUID)
├── brand_id (FK: brands)
├── name
├── yjs_document (BYTEA) -- CRDTドキュメント状態
├── created_by (FK: users)
├── created_at
├── updated_at

canvas_versions
├── id (UUID)
├── canvas_id (FK: canvas_projects)
├── version_number
├── snapshot_data (BYTEA)
├── created_by (FK: users)
├── created_at
├── description

canvas_operations
├── id (UUID)
├── canvas_id (FK: canvas_projects)
├── user_id (FK: users)
├── operation_type (add/update/delete/move)
├── target_type (image/text/shape/node)
├── target_id
├── before_state (JSONB)
├── after_state (JSONB)
├── created_at

canvas_presence
├── canvas_id (FK: canvas_projects)
├── user_id (FK: users)
├── cursor_position (JSONB)
├── selected_objects (JSONB)
├── last_active_at
```

---

## 12. API設計（主要エンドポイント）

### 12.1 認証
```
POST /auth/signup
POST /auth/signin
POST /auth/signout
POST /auth/reset-password
POST /auth/oauth/google
POST /auth/oauth/apple
```

### 12.2 ブランド管理
```
GET    /brands
POST   /brands
GET    /brands/:id
PUT    /brands/:id
DELETE /brands/:id
GET    /brands/:id/members
POST   /brands/:id/members/invite
DELETE /brands/:id/members/:userId
PUT    /brands/:id/members/:userId/role
```

### 12.3 画像生成
```
POST   /generate/text-to-image
POST   /generate/image-edit
POST   /generate/multi-image
GET    /generate/jobs/:jobId
POST   /generate/jobs/:jobId/cancel
```

### 12.4 画像管理
```
GET    /images
GET    /images/:id
DELETE /images/:id
POST   /images/:id/favorite
DELETE /images/:id/favorite
POST   /images/:id/tags
DELETE /images/:id/tags/:tagId
POST   /images/:id/share-link
GET    /images/download-zip
```

### 12.5 フォルダ・タグ
```
GET    /folders
POST   /folders
PUT    /folders/:id
DELETE /folders/:id
POST   /folders/:id/images

GET    /tags
POST   /tags
DELETE /tags/:id
```

### 12.6 スタイルプリセット
```
GET    /presets
POST   /presets
PUT    /presets/:id
DELETE /presets/:id
```

### 12.7 外部連携
```
POST   /integrations/shopify/connect
POST   /integrations/shopify/upload
POST   /integrations/base/connect
POST   /integrations/stores/connect
POST   /integrations/google-drive/connect
POST   /integrations/google-drive/export
POST   /integrations/dropbox/connect
POST   /integrations/figma/export
POST   /integrations/canva/export
```

### 12.8 キャンバス・共同編集
```
GET    /canvas
POST   /canvas
GET    /canvas/:id
PUT    /canvas/:id
DELETE /canvas/:id
GET    /canvas/:id/versions
POST   /canvas/:id/versions          -- スナップショット保存
PUT    /canvas/:id/rollback/:versionId
GET    /canvas/:id/operations        -- 変更履歴取得
WS     /canvas/:id/realtime          -- WebSocket接続
GET    /canvas/:id/presence          -- 参加者一覧
POST   /canvas/:id/export/tree       -- 派生ツリーZIPエクスポート
```

### 12.9 管理者
```
GET    /admin/users
GET    /admin/users/:id
PUT    /admin/users/:id/status
GET    /admin/analytics
GET    /admin/costs
GET    /admin/moderation/queue
PUT    /admin/moderation/:imageId
POST   /admin/announcements
```

---

## 13. 開発フェーズ

### Phase 1: 基盤構築（MVP）
- 認証システム（メール/Google/Apple）
- ブランド管理（シングルブランド）
- 基本的なText-to-Image生成
- 画像保存・一覧表示
- ダウンロード機能

### Phase 2: キャンバスUI基盤
- 無限キャンバス実装（Konva.js）
- ズーム/パン/グリッド/スナップ
- オブジェクト操作（ドラッグ/リサイズ/回転）
- フローティングツールバー
- テキスト/シェイプ追加
- レイヤー管理

### Phase 3: 派生ツリー・履歴
- ノードグラフ実装（React Flow）
- 派生ツリービュー（ベジェ曲線接続）
- 自動配置＋手動調整
- ミニマップ/折りたたみ
- Undo/Redo実装
- バージョンスナップショット

### Phase 4: 共同編集・コア機能
- Yjs + Supabase Realtime統合
- カーソル/選択範囲共有
- 変更履歴・ロールバック
- Image+Text編集機能
- Multi-Image合成
- 全画像生成機能の実装

### Phase 5: チーム・連携機能
- マルチブランド対応
- チーム機能（招待・権限）
- 外部連携（Shopify/BASE/STORES）
- クラウドストレージ連携
- フォルダ・タグ管理

### Phase 6: 高度な機能
- チャットベース編集UI
- スタイルプリセット
- テンプレート（サイズ/デザイン）
- 多言語対応
- デザインツール連携

### Phase 7: 管理・収益化
- 管理者ダッシュボード
- アナリティクス
- Stripe課金統合
- プラン制限機能

---

## 14. セキュリティ要件

- 全通信のHTTPS化
- Supabase RLS（Row Level Security）による権限制御
- APIキーのサーバーサイド管理（環境変数）
- 画像ストレージの署名付きURL
- レート制限（API abuse防止）
- 入力バリデーション
- XSS/CSRF対策

---

## 15. パフォーマンス要件

- 画像生成レスポンス：30秒以内（目標）
- ページロード：3秒以内
- 画像一覧のページネーション
- 画像のサムネイル自動生成
- CDNによる静的アセット配信

---

## 16. 今後の検討事項

- ネイティブアプリ開発（React Native or Flutter）
- SNS直接投稿機能（Instagram/X/TikTok）
- AIによる自動タグ付け
- 画像検索（類似画像検索）
- テンプレートマーケットプレイス
- API公開（サードパーティ向け）

---

**ドキュメント作成日**: 2025年12月3日  
**バージョン**: 1.1  
**最終更新**: 2025年12月3日（キャンバスUI・共同編集機能追加）  
**ステータス**: 要件定義完了

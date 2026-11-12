-- ファッションスタジオの生成結果の 👍👎「フィードバックする」（本家 Lightchain の ai-task-feedback と同じ役目）。
-- 結果の画像1枚につき1行。あとから押した内容で上書きする。プロジェクト・ブランド・利用者が消えると一緒に消える。
CREATE TABLE studio_result_feedback (
  document_id TEXT NOT NULL REFERENCES canvas_documents(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_path TEXT,
  studio_function TEXT CHECK (studio_function IS NULL OR studio_function IN ('text', 'region', 'underwear', '3d')),
  direction INTEGER CHECK (direction IS NULL OR direction IN (0, 1)),
  reasons TEXT NOT NULL DEFAULT '[]',
  remark TEXT NOT NULL DEFAULT '' CHECK (length(remark) <= 50),
  improve TEXT NOT NULL DEFAULT '' CHECK (length(improve) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (document_id, object_id)
);
-- statement-breakpoint

CREATE INDEX studio_result_feedback_brand_updated_idx
  ON studio_result_feedback (brand_id, updated_at DESC);

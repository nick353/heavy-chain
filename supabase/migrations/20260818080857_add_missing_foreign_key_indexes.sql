-- Add indexes for foreign-key columns identified by the linked Supabase
-- performance advisor. Existing indexes cover the primary access paths, but
-- these columns are independently referenced by DELETE/UPDATE checks and
-- relationship joins. This migration is additive and does not alter policy
-- semantics or remove existing indexes.

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_actor_user_id
  ON public.admin_audit_logs(actor_user_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_brand_id
  ON public.admin_audit_logs(brand_id);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_brand_id
  ON public.api_usage_logs(brand_id);

CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id
  ON public.api_usage_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_brand_subscriptions_plan_id
  ON public.brand_subscriptions(plan_id);

CREATE INDEX IF NOT EXISTS idx_canvas_documents_owner_id
  ON public.canvas_documents(owner_id);

CREATE INDEX IF NOT EXISTS idx_edge_function_runs_usage_event_id
  ON public.edge_function_runs(usage_event_id);

CREATE INDEX IF NOT EXISTS idx_edge_function_runs_user_id
  ON public.edge_function_runs(user_id);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_brand_id
  ON public.feedback_submissions(brand_id);

CREATE INDEX IF NOT EXISTS idx_folders_parent_folder_id
  ON public.folders(parent_folder_id);

CREATE INDEX IF NOT EXISTS idx_generated_images_parent_image_id
  ON public.generated_images(parent_image_id);

CREATE INDEX IF NOT EXISTS idx_image_folders_folder_id
  ON public.image_folders(folder_id);

CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id
  ON public.image_tags(tag_id);

CREATE INDEX IF NOT EXISTS idx_lightchain_task_steps_user_id
  ON public.lightchain_task_steps(user_id);

CREATE INDEX IF NOT EXISTS idx_share_links_created_by
  ON public.share_links(created_by);

CREATE INDEX IF NOT EXISTS idx_style_presets_brand_id
  ON public.style_presets(brand_id);

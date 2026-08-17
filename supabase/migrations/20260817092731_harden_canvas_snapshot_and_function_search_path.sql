BEGIN;

-- Keep the public trigger helper deterministic and prevent an attacker-controlled
-- search_path from changing object resolution when it is invoked by a trigger.
ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public, pg_temp;

-- Canvas snapshots are written through the authenticated Edge Function path.
-- Explicitly remove anonymous RPC execution while preserving the authenticated
-- grant used by the current Canvas persistence flow.
REVOKE EXECUTE ON FUNCTION public.update_canvas_document_snapshot(
  UUID, UUID, TEXT, JSONB, INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_canvas_document_snapshot(
  UUID, UUID, TEXT, JSONB, INTEGER
) TO authenticated;

COMMIT;

-- Durable Canvas documents. This is an additive migration: application rollback
-- must retain this table and all snapshots; no down migration is part of release.
CREATE TABLE IF NOT EXISTS public.canvas_documents (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '無題のプロジェクト',
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK (snapshot_version > 0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS canvas_documents_brand_updated_idx
  ON public.canvas_documents (brand_id, updated_at DESC);

ALTER TABLE public.canvas_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Canvas viewers can view documents" ON public.canvas_documents;
CREATE POLICY "Canvas viewers can view documents"
  ON public.canvas_documents FOR SELECT
  TO authenticated
  USING (private.has_brand_role(brand_id, 'viewer'));

DROP POLICY IF EXISTS "Canvas editors can create documents" ON public.canvas_documents;
CREATE POLICY "Canvas editors can create documents"
  ON public.canvas_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND private.has_brand_role(brand_id, 'editor')
  );

DROP POLICY IF EXISTS "Canvas editors can update documents" ON public.canvas_documents;
CREATE POLICY "Canvas editors can update documents"
  ON public.canvas_documents FOR UPDATE
  TO authenticated
  USING (private.has_brand_role(brand_id, 'editor'))
  WITH CHECK (
    private.has_brand_role(brand_id, 'editor')
  );

DROP POLICY IF EXISTS "Canvas owners can delete documents" ON public.canvas_documents;
CREATE POLICY "Canvas owners can delete documents"
  ON public.canvas_documents FOR DELETE
  TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR private.has_brand_role(brand_id, 'owner')
  );

CREATE OR REPLACE FUNCTION public.prevent_canvas_document_ownership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN
    RAISE EXCEPTION 'canvas_document_ownership_immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canvas_documents_ownership_immutable ON public.canvas_documents;
CREATE TRIGGER canvas_documents_ownership_immutable
  BEFORE UPDATE ON public.canvas_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_canvas_document_ownership_change();

DROP TRIGGER IF EXISTS canvas_documents_updated_at ON public.canvas_documents;
CREATE TRIGGER canvas_documents_updated_at
  BEFORE UPDATE ON public.canvas_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.canvas_documents IS
  'Durable Heavy Chain Canvas snapshots. Additive rollout; application rollback retains rows and snapshots.';

-- The conditional update is kept in the database so revision is always
-- incremented atomically and cannot be supplied by the client.
CREATE OR REPLACE FUNCTION public.update_canvas_document_snapshot(
  p_document_id UUID,
  p_brand_id UUID,
  p_title TEXT,
  p_snapshot JSONB,
  p_expected_revision INTEGER
)
RETURNS TABLE (
  id UUID,
  owner_id UUID,
  brand_id UUID,
  title TEXT,
  snapshot JSONB,
  snapshot_version INTEGER,
  revision INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.canvas_documents AS document
  SET title = p_title,
      snapshot = p_snapshot,
      snapshot_version = 1,
      revision = document.revision + 1,
      updated_at = NOW()
  WHERE document.id = p_document_id
    AND document.brand_id = p_brand_id
    AND document.revision = p_expected_revision
    AND private.has_brand_role(document.brand_id, 'editor')
  RETURNING
    document.id,
    document.owner_id,
    document.brand_id,
    document.title,
    document.snapshot,
    document.snapshot_version,
    document.revision,
    document.created_at,
    document.updated_at;
$$;

REVOKE ALL ON FUNCTION public.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_canvas_document_snapshot(UUID, UUID, TEXT, JSONB, INTEGER) TO authenticated;

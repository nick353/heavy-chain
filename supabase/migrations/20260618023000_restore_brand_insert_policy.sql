-- Restore first-run brand creation after role-based brand policies are applied.
-- Existing viewer/editor/delete policies require a brand to already exist, so
-- new authenticated users also need an explicit owner insert path.

DROP POLICY IF EXISTS "Users can create brands" ON public.brands;
CREATE POLICY "Users can create brands"
  ON public.brands FOR INSERT
  WITH CHECK (owner_id = auth.uid());

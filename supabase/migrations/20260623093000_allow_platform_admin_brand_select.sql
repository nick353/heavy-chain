-- Let platform admins resolve brand names in Runway MCP approval screens.

DROP POLICY IF EXISTS "Platform admins can view brands" ON public.brands;
CREATE POLICY "Platform admins can view brands"
  ON public.brands FOR SELECT
  TO authenticated
  USING (private.is_current_user_admin());

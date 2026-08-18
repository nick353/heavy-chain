BEGIN;

-- Keep the Lightchain task-step authorization predicates unchanged while
-- allowing PostgreSQL to evaluate auth.uid() once per statement instead of
-- once per row. The existing brand-owner/member checks remain identical.
DROP POLICY IF EXISTS "Brand viewers can view Lightchain task steps" ON public.lightchain_task_steps;
CREATE POLICY "Brand viewers can view Lightchain task steps"
  ON public.lightchain_task_steps FOR SELECT
  TO authenticated
  USING (
    brand_id IN (SELECT id FROM public.brands WHERE owner_id = (SELECT auth.uid()))
    OR brand_id IN (
      SELECT brand_id
      FROM public.brand_members
      WHERE user_id = (SELECT auth.uid())
        AND joined_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "Brand editors can create Lightchain task steps" ON public.lightchain_task_steps;
CREATE POLICY "Brand editors can create Lightchain task steps"
  ON public.lightchain_task_steps FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      brand_id IN (SELECT id FROM public.brands WHERE owner_id = (SELECT auth.uid()))
      OR brand_id IN (
        SELECT brand_id
        FROM public.brand_members
        WHERE user_id = (SELECT auth.uid())
          AND role IN ('owner', 'admin', 'editor')
          AND joined_at IS NOT NULL
      )
    )
  );

DROP POLICY IF EXISTS "Brand editors can update Lightchain task steps" ON public.lightchain_task_steps;
CREATE POLICY "Brand editors can update Lightchain task steps"
  ON public.lightchain_task_steps FOR UPDATE
  TO authenticated
  USING (
    brand_id IN (SELECT id FROM public.brands WHERE owner_id = (SELECT auth.uid()))
    OR brand_id IN (
      SELECT brand_id
      FROM public.brand_members
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin', 'editor')
        AND joined_at IS NOT NULL
    )
  )
  WITH CHECK (
    brand_id IN (SELECT id FROM public.brands WHERE owner_id = (SELECT auth.uid()))
    OR brand_id IN (
      SELECT brand_id
      FROM public.brand_members
      WHERE user_id = (SELECT auth.uid())
        AND role IN ('owner', 'admin', 'editor')
        AND joined_at IS NOT NULL
    )
  );

-- Preserve the own-feedback/admin visibility boundary while applying the same
-- statement-stable auth.uid() optimization.
DROP POLICY IF EXISTS "Users can view own beta feedback" ON public.feedback_submissions;
CREATE POLICY "Users can view own beta feedback"
  ON public.feedback_submissions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_current_user_admin());

COMMIT;

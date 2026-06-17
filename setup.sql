-- Deprecated guard.
-- Do not run this root-level file. Database and storage setup are now managed
-- by Supabase migrations, with private buckets and RLS-backed access policies.
--
-- Normal setup:
--   supabase db push
--
-- Emergency storage manual reapply only:
--   Run supabase/storage-setup.sql in the Supabase SQL Editor.

DO $$
BEGIN
  RAISE EXCEPTION
    'Deprecated setup.sql: use Supabase migrations. For emergency storage repair only, use supabase/storage-setup.sql.';
END $$;

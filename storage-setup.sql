-- Deprecated guard.
-- Do not run this root-level file. Storage setup is now part of Supabase
-- migrations, with private buckets and RLS-backed access policies.
--
-- Normal setup:
--   supabase db push
--
-- Emergency manual reapply:
--   Run supabase/storage-setup.sql in the Supabase SQL Editor.

DO $$
BEGIN
  RAISE EXCEPTION
    'Deprecated storage-setup.sql: use supabase migrations or supabase/storage-setup.sql instead.';
END $$;

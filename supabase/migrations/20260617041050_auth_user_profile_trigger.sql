CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    name,
    avatar_url
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'name', ''),
      NULLIF(NEW.raw_user_meta_data ->> 'full_name', '')
    ),
    NULLIF(NEW.raw_user_meta_data ->> 'avatar_url', '')
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(public.users.name, EXCLUDED.name),
    avatar_url = COALESCE(public.users.avatar_url, EXCLUDED.avatar_url);

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.handle_new_auth_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.handle_new_auth_user() FROM anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_new_auth_user();

DROP FUNCTION IF EXISTS public.handle_new_auth_user();

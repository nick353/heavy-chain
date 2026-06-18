CREATE OR REPLACE FUNCTION public.create_brand(
  p_name TEXT,
  p_tone_description TEXT DEFAULT NULL,
  p_target_audience TEXT DEFAULT NULL
)
RETURNS public.brands
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_brand public.brands;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.brands (
    owner_id,
    name,
    tone_description,
    target_audience
  )
  VALUES (
    v_user_id,
    p_name,
    p_tone_description,
    p_target_audience
  )
  RETURNING * INTO v_brand;

  INSERT INTO public.brand_members (
    brand_id,
    user_id,
    role,
    joined_at
  )
  VALUES (
    v_brand.id,
    v_user_id,
    'owner',
    NOW()
  )
  ON CONFLICT (brand_id, user_id) DO UPDATE
    SET role = 'owner',
        joined_at = COALESCE(public.brand_members.joined_at, EXCLUDED.joined_at);

  RETURN v_brand;
END;
$$;

REVOKE ALL ON FUNCTION public.create_brand(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_brand(TEXT, TEXT, TEXT) TO authenticated;

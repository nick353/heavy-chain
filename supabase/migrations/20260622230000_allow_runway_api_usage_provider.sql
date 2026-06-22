-- Allow Runway usage records now that image generation is Runway-first.

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT c.conname
    INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.api_usage_logs'::regclass
    AND c.contype = 'c'
    AND c.conkey = ARRAY[a.attnum]
    AND a.attname = 'provider'
    AND pg_get_constraintdef(c.oid) LIKE '%provider%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.api_usage_logs DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END;
$$;

ALTER TABLE public.api_usage_logs
  ADD CONSTRAINT api_usage_logs_provider_check
  CHECK (provider IN ('openai', 'gemini', 'runway'));

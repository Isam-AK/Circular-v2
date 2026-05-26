-- ============================================================
-- Circular — Atomic increment for users.carbon_saved
-- Run this once in the Supabase SQL editor.
-- Idempotent: safe to re-run.
-- ============================================================
--
-- Why an RPC instead of a client-side UPDATE:
--   `UPDATE users SET carbon_saved = carbon_saved + $1` from the client
--   works under RLS (users can update their own row), but two concurrent
--   trip logs could race and lose one increment. SECURITY DEFINER + a
--   single statement keeps the math atomic and consistent.

CREATE OR REPLACE FUNCTION public.increment_carbon_saved(
  target_user_id UUID,
  delta NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_total NUMERIC;
BEGIN
  -- Caller must be the same user (RLS-equivalent guard at the function level).
  IF auth.uid() IS NULL OR auth.uid() <> target_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.users
    SET carbon_saved = carbon_saved + delta,
        updated_at = now()
    WHERE id = target_user_id
    RETURNING carbon_saved INTO new_total;

  RETURN new_total;
END;
$$;

-- Allow authenticated users to call it (auth check inside the function).
GRANT EXECUTE ON FUNCTION public.increment_carbon_saved(UUID, NUMERIC) TO authenticated;

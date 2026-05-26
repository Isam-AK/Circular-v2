-- ============================================================
-- Circular — Replace recalculate_carbon_score with a safe version
-- Run this once in the Supabase SQL editor.
-- Idempotent (uses CREATE OR REPLACE).
-- ============================================================
--
-- Background: the version of recalculate_carbon_score() shipped in the
-- master schema.sql either didn't run at all in this project or runs
-- under RLS in a way that prevents its UPDATE on public.users from
-- taking effect (carbon_score stayed at 0 even with rows in
-- mobility_logs / transactions). This version:
--   1. Sums carbon_kg from both source tables explicitly.
--   2. Uses SECURITY DEFINER so the UPDATE is not blocked by RLS.
--   3. Guards on auth.uid() so a user can only recompute their own row.
--   4. Returns the new total so callers can confirm it ran.

CREATE OR REPLACE FUNCTION public.recalculate_carbon_score(
  target_user_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total NUMERIC;
BEGIN
  -- Caller must be the same user (RLS-equivalent guard at the function level).
  IF auth.uid() IS NULL OR auth.uid() <> target_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT
    COALESCE(SUM(carbon_kg), 0)
    INTO total
  FROM (
    SELECT carbon_kg
      FROM public.transactions
      WHERE user_id = target_user_id
    UNION ALL
    SELECT carbon_kg
      FROM public.mobility_logs
      WHERE user_id = target_user_id
  ) combined;

  UPDATE public.users
    SET carbon_score = total,
        updated_at = now()
    WHERE id = target_user_id;

  RETURN total;
END;
$$;

-- Allow authenticated users to call it (auth check is inside the function).
GRANT EXECUTE ON FUNCTION public.recalculate_carbon_score(UUID) TO authenticated;

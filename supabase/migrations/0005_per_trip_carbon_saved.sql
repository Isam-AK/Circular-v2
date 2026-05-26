-- ============================================================
-- Circular — Store per-trip carbon savings + replace increment with recalc
-- Run this once in the Supabase SQL editor.
-- Idempotent: safe to re-run.
-- ============================================================
--
-- Why: the per-trip increment_carbon_saved RPC was vulnerable to drift —
-- any silent RPC failure (or a trip logged before the RPC existed)
-- meant users.carbon_saved permanently diverged from the actual sum of
-- mobility_logs savings. This migration aligns savings with the same
-- "SUM from scratch on each insert" pattern that already works for
-- carbon_score, so the two metrics can never drift out of sync again.
--
-- Steps:
--   1. Add a carbon_saved_kg column to mobility_logs (default 0).
--   2. Backfill it for all existing rows using current emission factors
--      (baseline = 0.171 kg/km, average petrol car).
--   3. Define recalculate_carbon_saved(user_id) that SUMs the column
--      and writes the total to users.carbon_saved.
--   4. Drop the old increment_carbon_saved RPC.

-- ------------------------------------------------------------
-- 1. Column
-- ------------------------------------------------------------

ALTER TABLE public.mobility_logs
  ADD COLUMN IF NOT EXISTS carbon_saved_kg NUMERIC(10,4) NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 2. Backfill existing rows
--    Factors here MUST match Circular/src/lib/emissions.ts. If you
--    change factors there, re-run this migration to re-backfill.
-- ------------------------------------------------------------

UPDATE public.mobility_logs SET carbon_saved_kg = GREATEST(0, ROUND(
  CASE mode
    WHEN 'walk'       THEN 0.171
    WHEN 'bike'       THEN 0.171
    WHEN 'bus'        THEN 0.171 - 0.105
    WHEN 'train'      THEN 0.171 - 0.041
    WHEN 'car'        THEN 0
    WHEN 'ev_car'     THEN 0.171 - 0.05
    WHEN 'hybrid_car' THEN 0.171 - 0.103
    WHEN 'rideshare'  THEN 0.171 - 0.131
    WHEN 'flight'     THEN 0  -- emits more than baseline; no savings
    ELSE 0
  END * distance_km
, 4));

-- ------------------------------------------------------------
-- 3. recalculate_carbon_saved(user_id) — mirrors recalculate_carbon_score
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recalculate_carbon_saved(
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
  IF auth.uid() IS NULL OR auth.uid() <> target_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(SUM(carbon_saved_kg), 0) INTO total
    FROM public.mobility_logs
    WHERE user_id = target_user_id;

  UPDATE public.users
    SET carbon_saved = total,
        updated_at = now()
    WHERE id = target_user_id;

  RETURN total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_carbon_saved(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 4. Retire the old per-trip increment RPC
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.increment_carbon_saved(UUID, NUMERIC);

-- ------------------------------------------------------------
-- Verification (read-only):
--   SELECT user_id, SUM(carbon_saved_kg) FROM mobility_logs GROUP BY user_id;
--   SELECT id, carbon_saved FROM users;
-- The two queries should agree for each user after the next trip log
-- triggers recalculate_carbon_saved.
-- ------------------------------------------------------------

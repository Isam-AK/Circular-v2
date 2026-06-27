-- ============================================================
-- Circular — Recycling logs (CO₂ + money saved) feature
-- Idempotent: safe to re-run.
-- ============================================================
--
-- Lets a user record what they recycled (e.g. "500 ml plastic bottle × 30")
-- and snapshots both the CO₂ avoided and the deposit (German Pfand) refunded
-- at log time. CO₂ savings roll into users.carbon_saved alongside mobility
-- savings — see the extended recalculate_carbon_saved() at the bottom.
--
-- Savings factors are computed client-side in Circular/src/lib/recycling.ts
-- and persisted here as a snapshot, mirroring the mobility_logs approach
-- (per-row carbon_saved_kg + SUM-from-scratch recalc, never drifts).
--
-- Steps:
--   1. recycling_logs table + index
--   2. RLS (owner-only CRUD)
--   3. recycling-images storage bucket + per-owner RLS
--   4. recycling_totals(user) RPC for the Recycle screen header
--   5. recalculate_carbon_saved(user) extended to add recycling CO₂

-- ------------------------------------------------------------
-- 1. Table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recycling_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Catalog key from src/lib/recycling.ts, e.g. 'pet_bottle_500'.
  material_key    text NOT NULL,
  -- Human-readable label snapshot (e.g. '500 ml plastic bottle'), so old
  -- logs still read correctly even if the catalog label changes later.
  label           text NOT NULL,
  quantity        integer NOT NULL CHECK (quantity > 0),
  -- Snapshots of the computed savings at log time.
  co2_saved_kg    numeric(10,4) NOT NULL DEFAULT 0 CHECK (co2_saved_kg >= 0),
  money_saved_eur numeric(10,2) NOT NULL DEFAULT 0 CHECK (money_saved_eur >= 0),
  -- How the entry was created: 'preset' | 'photo' | 'barcode'.
  source          text NOT NULL DEFAULT 'preset'
                    CHECK (source IN ('preset', 'photo', 'barcode')),
  -- Optional public URL of a photo (recycling-images bucket).
  photo_url       text,
  -- Optional scanned barcode (EAN/UPC) when source = 'barcode'.
  barcode         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recycling_logs_user_created_idx
  ON public.recycling_logs (user_id, created_at DESC);

-- ------------------------------------------------------------
-- 2. RLS — owner-only CRUD (same shape as the other user-owned tables)
-- ------------------------------------------------------------

ALTER TABLE public.recycling_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own recycling logs"   ON public.recycling_logs;
DROP POLICY IF EXISTS "Users can insert own recycling logs" ON public.recycling_logs;
DROP POLICY IF EXISTS "Users can update own recycling logs" ON public.recycling_logs;
DROP POLICY IF EXISTS "Users can delete own recycling logs" ON public.recycling_logs;

CREATE POLICY "Users can read own recycling logs"
  ON public.recycling_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own recycling logs"
  ON public.recycling_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own recycling logs"
  ON public.recycling_logs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own recycling logs"
  ON public.recycling_logs FOR DELETE
  USING (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. recycling-images storage bucket + RLS
--    Optional per-log photo, written to recycling-images/<uid>/<file>.
--    Public-read, owner-only write (same pattern as 0007 / 0008).
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('recycling-images', 'recycling-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Anyone can read recycling images"   ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own recycling image" ON storage.objects;
DROP POLICY IF EXISTS "Users can replace own recycling image" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own recycling image" ON storage.objects;

CREATE POLICY "Anyone can read recycling images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recycling-images');

CREATE POLICY "Users can upload own recycling image"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'recycling-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can replace own recycling image"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'recycling-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own recycling image"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'recycling-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ------------------------------------------------------------
-- 4. recycling_totals(user) — aggregate for the Recycle screen header
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recycling_totals(
  target_user_id UUID
)
RETURNS TABLE (
  co2_saved_kg    NUMERIC,
  money_saved_eur NUMERIC,
  item_count      BIGINT,
  log_count       BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> target_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
    SELECT
      COALESCE(SUM(r.co2_saved_kg), 0)::NUMERIC,
      COALESCE(SUM(r.money_saved_eur), 0)::NUMERIC,
      COALESCE(SUM(r.quantity), 0)::BIGINT,
      COUNT(*)::BIGINT
    FROM public.recycling_logs r
    WHERE r.user_id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recycling_totals(UUID) TO authenticated;

-- ------------------------------------------------------------
-- 5. Extend recalculate_carbon_saved to include recycling CO₂
--    Replaces the 0005 definition: users.carbon_saved is now the SUM of
--    mobility_logs.carbon_saved_kg + recycling_logs.co2_saved_kg. Still
--    SECURITY DEFINER, idempotent, and self-only.
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
  mobility_total  NUMERIC;
  recycling_total NUMERIC;
  total           NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> target_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(SUM(carbon_saved_kg), 0) INTO mobility_total
    FROM public.mobility_logs
    WHERE user_id = target_user_id;

  SELECT COALESCE(SUM(co2_saved_kg), 0) INTO recycling_total
    FROM public.recycling_logs
    WHERE user_id = target_user_id;

  total := mobility_total + recycling_total;

  UPDATE public.users
    SET carbon_saved = total,
        updated_at = now()
    WHERE id = target_user_id;

  RETURN total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_carbon_saved(UUID) TO authenticated;

-- ------------------------------------------------------------
-- Verification (read-only):
--   SELECT material_key, quantity, co2_saved_kg, money_saved_eur
--     FROM recycling_logs ORDER BY created_at DESC LIMIT 5;
--   SELECT * FROM recycling_totals(auth.uid());
--   -- carbon_saved should equal mobility + recycling sums:
--   SELECT id, carbon_saved FROM users;
-- ------------------------------------------------------------

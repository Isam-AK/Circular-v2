-- ============================================================
-- Circular — Personal Sustainability OS
-- Supabase / PostgreSQL + PostGIS Master Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE transport_mode AS ENUM (
  'walk',
  'bike',
  'bus',
  'train',
  'car',
  'rideshare',
  'flight'
);

CREATE TYPE item_condition AS ENUM (
  'new',
  'like_new',
  'good',
  'fair',
  'needs_repair'
);

CREATE TYPE item_status AS ENUM (
  'available',
  'reserved',
  'shared',
  'withdrawn'
);

CREATE TYPE transaction_category AS ENUM (
  'food',
  'transport',
  'housing',
  'clothing',
  'electronics',
  'services',
  'entertainment',
  'utilities',
  'other'
);

-- ============================================================
-- 1. USERS
-- ============================================================

CREATE TABLE public.users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  -- Carbon tracking
  carbon_score    NUMERIC(12,2) NOT NULL DEFAULT 0.00,   -- kg CO₂e lifetime
  carbon_saved    NUMERIC(12,2) NOT NULL DEFAULT 0.00,   -- kg CO₂e saved via green actions
  streak_days     INT NOT NULL DEFAULT 0,                 -- consecutive "green" days
  level           INT NOT NULL DEFAULT 1,                 -- gamification level
  xp              INT NOT NULL DEFAULT 0,                 -- experience points
  -- Plaid link
  plaid_access_token  TEXT,                               -- encrypted at rest via Supabase Vault
  plaid_item_id       TEXT,
  -- Location (last known, for proximity features)
  last_location   geography(POINT, 4326),
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- ============================================================
-- 2. TRANSACTIONS (Plaid-synced bank data + carbon weight)
-- ============================================================

CREATE TABLE public.transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Plaid fields
  plaid_transaction_id TEXT UNIQUE,
  merchant_name       TEXT,
  amount              NUMERIC(10,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  transaction_date    DATE NOT NULL,
  -- Carbon calculation
  category            transaction_category NOT NULL DEFAULT 'other',
  carbon_kg           NUMERIC(10,4) NOT NULL DEFAULT 0.0,    -- kg CO₂e via Climatiq
  climatiq_activity_id TEXT,                                  -- Climatiq emission factor used
  -- Meta
  raw_payload         JSONB,                                  -- full Plaid response for audit
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_user ON public.transactions(user_id);
CREATE INDEX idx_transactions_date ON public.transactions(user_id, transaction_date DESC);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role inserts transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. MOBILITY LOGS (walked/biked vs driven)
-- ============================================================

CREATE TABLE public.mobility_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mode            transport_mode NOT NULL,
  distance_km     NUMERIC(8,3) NOT NULL,
  duration_min    NUMERIC(8,2),
  carbon_kg       NUMERIC(10,4) NOT NULL DEFAULT 0.0,
  -- Route geometry for visualisation
  route           geography(LINESTRING, 4326),
  start_point     geography(POINT, 4326),
  end_point       geography(POINT, 4326),
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mobility_user ON public.mobility_logs(user_id);
CREATE INDEX idx_mobility_date ON public.mobility_logs(user_id, started_at DESC);

ALTER TABLE public.mobility_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own mobility logs"
  ON public.mobility_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mobility logs"
  ON public.mobility_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 4. SHARED ITEMS (hyper-local resource sharing)
-- ============================================================

CREATE TABLE public.shared_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  image_urls      TEXT[] DEFAULT '{}',
  condition       item_condition NOT NULL DEFAULT 'good',
  status          item_status NOT NULL DEFAULT 'available',
  -- Location for proximity matching
  location        geography(POINT, 4326) NOT NULL,
  -- Carbon impact estimate (kg CO₂e avoided by sharing instead of buying new)
  carbon_saved_kg NUMERIC(10,4) NOT NULL DEFAULT 0.0,
  tags            TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index for proximity queries (e.g. items within 5 km)
CREATE INDEX idx_shared_items_location ON public.shared_items USING GIST(location);
CREATE INDEX idx_shared_items_owner ON public.shared_items(owner_id);
CREATE INDEX idx_shared_items_status ON public.shared_items(status) WHERE status = 'available';

ALTER TABLE public.shared_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can browse available items"
  ON public.shared_items FOR SELECT
  USING (status = 'available' OR auth.uid() = owner_id);

CREATE POLICY "Owners can insert items"
  ON public.shared_items FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Owners can update own items"
  ON public.shared_items FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Owners can delete own items"
  ON public.shared_items FOR DELETE
  USING (auth.uid() = owner_id);

-- ============================================================
-- 5. HELPER FUNCTIONS
-- ============================================================

-- Proximity search: find shared items within a radius (meters)
CREATE OR REPLACE FUNCTION public.nearby_items(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  radius_m INT DEFAULT 5000
)
RETURNS SETOF public.shared_items
LANGUAGE sql STABLE
AS $$
  SELECT *
  FROM public.shared_items
  WHERE status = 'available'
    AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
          radius_m
        )
  ORDER BY location <-> ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography;
$$;

-- Recalculate user's aggregate carbon score from transactions + mobility
CREATE OR REPLACE FUNCTION public.recalculate_carbon_score(target_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  total NUMERIC(12,2);
BEGIN
  SELECT COALESCE(SUM(carbon_kg), 0) INTO total
  FROM (
    SELECT carbon_kg FROM public.transactions WHERE user_id = target_user_id
    UNION ALL
    SELECT carbon_kg FROM public.mobility_logs WHERE user_id = target_user_id
  ) combined;

  UPDATE public.users SET carbon_score = total, updated_at = now()
  WHERE id = target_user_id;

  RETURN total;
END;
$$;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_shared_items_updated_at
  BEFORE UPDATE ON public.shared_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

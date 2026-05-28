-- ============================================================
-- Circular — Climatiq factor cache + per-transaction provenance
-- Phase 3 of the Plaid integration: live Climatiq factors with a
-- DB-backed cache and graceful fallback to the hardcoded EXIOBASE
-- values from Phase 2.
-- Idempotent: safe to re-run.
-- ============================================================
--
-- Why a cache table:
-- Climatiq's spend-based EFs are linear in USD (kg per $1 of spend),
-- so the factor for a given activity_id doesn't depend on the amount.
-- We hit the API once per unique activity_id, persist the resulting
-- kg_per_usd, and multiply locally for every transaction that uses
-- that activity. A 30-day TTL means we re-validate ~monthly.
--
-- Why factor_source on transactions:
-- When Climatiq is down, rate-limits us, or returns no match for an
-- activity_id (some of our IDs are placeholders), plaid-sync-
-- transactions falls back to the Phase 2 hardcoded factor. Recording
-- the provenance per-row lets the UI distinguish live vs fallback
-- estimates, and lets us audit how much of the user's carbon score
-- is genuinely Climatiq-sourced.

-- ------------------------------------------------------------
-- 1. climatiq_factor_cache
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.climatiq_factor_cache (
  activity_id   TEXT PRIMARY KEY,
  kg_per_usd    NUMERIC(12,6) NOT NULL,
  -- 'climatiq:<source string, e.g. EXIOBASE 3.8.2>' for live hits,
  -- 'fallback' when we accepted the Phase 2 hardcoded value because
  -- Climatiq returned no match or errored.
  source        TEXT NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The cache is service-role-only; no end user reads or writes it
-- directly. Enable RLS and define no policies so authenticated /
-- anon roles get a default-deny.
ALTER TABLE public.climatiq_factor_cache ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. transactions.factor_source
-- ------------------------------------------------------------

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS factor_source TEXT;

-- ------------------------------------------------------------
-- Verification (read-only):
--   SELECT COUNT(*) FROM public.climatiq_factor_cache;
--   SELECT factor_source, COUNT(*)
--     FROM public.transactions GROUP BY factor_source;
-- ------------------------------------------------------------

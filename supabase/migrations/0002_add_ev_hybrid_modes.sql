-- ============================================================
-- Circular — Add EV + Hybrid transport modes
-- Run this once in the Supabase SQL editor.
-- ============================================================
--
-- Note on ALTER TYPE ADD VALUE:
--   In Postgres, adding a value to an existing enum cannot run inside a
--   transaction block alongside other statements that reference the new
--   value. The IF NOT EXISTS clause makes this idempotent so the
--   migration is safe to re-run.

ALTER TYPE transport_mode ADD VALUE IF NOT EXISTS 'ev_car';
ALTER TYPE transport_mode ADD VALUE IF NOT EXISTS 'hybrid_car';

-- Verify (read-only):
-- SELECT unnest(enum_range(NULL::transport_mode));

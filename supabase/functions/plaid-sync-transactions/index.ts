// ============================================================
// plaid-sync-transactions
//
// Pulls the last 30 days of transactions from Plaid for the authenticated
// user, classifies each into a Climatiq `activity_id` + DB category via
// _shared/spend-carbon.ts, resolves the kg-CO2e-per-USD factor for each
// unique activity from Climatiq (with a 30-day DB cache + graceful
// fallback to hardcoded factors) via _shared/climatiq.ts, and upserts
// the resulting rows into public.transactions. Idempotent via Plaid's
// stable `transaction_id` (DB column `plaid_transaction_id` has a
// UNIQUE constraint).
//
// After insert, calls recalculate_carbon_score so users.carbon_score
// reflects spending impact alongside mobility logs.
//
// Phase 3 of the Plaid integration. Phase 1 added the bank-connect
// flow; Phase 2 added classification + hardcoded factors; this phase
// adds live Climatiq lookups behind a cache.
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { classifyTransaction } from '../_shared/spend-carbon.ts';
import { getFactors } from '../_shared/climatiq.ts';

const PLAID_CLIENT_ID = Deno.env.get('PLAID_CLIENT_ID');
const PLAID_SECRET = Deno.env.get('PLAID_SECRET');
const PLAID_ENV = Deno.env.get('PLAID_ENV') ?? 'sandbox';

const PLAID_BASE = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
}[PLAID_ENV] ?? 'https://sandbox.plaid.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

/** ISO date (YYYY-MM-DD) `n` days before today. */
function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      return jsonError(500, 'Plaid credentials not configured on server');
    }

    // ── Authenticate caller ──
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return jsonError(401, 'Missing Authorization header');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) return jsonError(401, 'Invalid auth token');

    // ── Look up the user's stored Plaid access_token ──
    // Service-role client so we can read the encrypted-at-rest tokens
    // even if RLS were tightened later.
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: userRow, error: userRowError } = await serviceClient
      .from('users')
      .select('plaid_access_token')
      .eq('id', user.id)
      .single();

    if (userRowError || !userRow?.plaid_access_token) {
      return jsonError(400, 'No bank connection on file. Connect a bank first.');
    }

    // ── Fetch transactions from Plaid ──
    // Using /transactions/get (vs /transactions/sync) because we don't
    // store a cursor yet — last-30-days snapshot is plenty for Phase 2.
    const plaidRes = await fetch(`${PLAID_BASE}/transactions/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: userRow.plaid_access_token,
        start_date: isoDaysAgo(30),
        end_date: isoDaysAgo(0),
        options: { count: 100, offset: 0 },
      }),
    });

    const plaidBody: any = await plaidRes.json();
    if (!plaidRes.ok) {
      console.error('[plaid] /transactions/get failed:', plaidBody);
      return jsonError(
        plaidRes.status,
        plaidBody.error_message ?? 'Plaid transaction fetch failed',
      );
    }

    const transactions: any[] = plaidBody.transactions ?? [];

    // ── Step 1: Classify each Plaid txn → activity_id + dbCategory ──
    // The mapping carries a hardcoded `kgPerUsd` (the Phase 2 fallback)
    // which we'll feed into the Climatiq lookup as the safety net.
    const classifications = transactions.map((t: any) => {
      // Prefer `detailed` (e.g. TRAVEL_FLIGHTS) for the tightest factor; fall
      // back to `primary`, then to the legacy `category[]` array if neither
      // PFC field is present (older Plaid items).
      const detailed: string | null = t.personal_finance_category?.detailed ?? null;
      const primary: string | null =
        t.personal_finance_category?.primary ??
        (Array.isArray(t.category) && t.category.length > 0
          ? t.category[0].toUpperCase().replace(/ /g, '_')
          : null);
      return { t, mapping: classifyTransaction(detailed, primary) };
    });

    // ── Step 2: Resolve live factors (Climatiq + cache + fallback) ──
    // Build the activity_id → hardcoded-kg fallback map so getFactors can
    // gracefully degrade per-id if Climatiq misses or errors.
    const fallbackByActivity = new Map<string, number>();
    for (const { mapping } of classifications) {
      // First entry wins; identical activity_ids always carry the same
      // hardcoded factor so duplicates would be redundant anyway.
      if (!fallbackByActivity.has(mapping.activityId)) {
        fallbackByActivity.set(mapping.activityId, mapping.kgPerUsd);
      }
    }
    const factors = await getFactors(
      Array.from(fallbackByActivity.keys()),
      serviceClient,
      (id) => fallbackByActivity.get(id) ?? 0,
    );

    // ── Step 3: Build DB rows ──
    const rows = classifications.map(({ t, mapping }) => {
      const factor = factors.get(mapping.activityId) ?? {
        kgPerUsd: mapping.kgPerUsd,
        source: 'fallback',
      };

      // Plaid amounts are POSITIVE for outflows (spending) and NEGATIVE for
      // inflows. Carbon is only meaningful for outflows.
      const amount = Number(t.amount);
      const carbonKg =
        amount > 0 ? Math.round(factor.kgPerUsd * amount * 10_000) / 10_000 : 0;

      return {
        user_id: user.id,
        plaid_transaction_id: t.transaction_id,
        merchant_name: t.merchant_name ?? t.name ?? null,
        amount,
        currency: t.iso_currency_code ?? 'USD',
        transaction_date: t.date,
        category: mapping.dbCategory,
        carbon_kg: carbonKg,
        climatiq_activity_id: mapping.activityId,
        factor_source: factor.source,
        raw_payload: t,
      };
    });

    // ── Upsert. plaid_transaction_id is UNIQUE so re-syncing is idempotent. ──
    let upserted = 0;
    if (rows.length > 0) {
      const { error: upsertError, count } = await serviceClient
        .from('transactions')
        .upsert(rows, { onConflict: 'plaid_transaction_id', count: 'exact' });

      if (upsertError) {
        console.error('[plaid-sync] upsert failed:', upsertError);
        return jsonError(500, `Transaction upsert failed: ${upsertError.message}`);
      }
      upserted = count ?? rows.length;
    }

    // ── Recalculate user's carbon_score (sums txns + mobility) ──
    // We call the recalc as the user, not via service role, so the
    // function's auth.uid() guard passes.
    const { error: recalcError } = await supabase.rpc('recalculate_carbon_score', {
      target_user_id: user.id,
    });
    if (recalcError) {
      console.warn('[plaid-sync] recalc failed:', recalcError.message);
    }

    const totalCarbon = rows.reduce((sum, r) => sum + r.carbon_kg, 0);
    const liveCount = rows.filter((r) => r.factor_source.startsWith('climatiq:')).length;
    const fallbackCount = rows.length - liveCount;

    return new Response(
      JSON.stringify({
        ok: true,
        fetched: transactions.length,
        upserted,
        total_carbon_kg: Math.round(totalCarbon * 100) / 100,
        live_factor_count: liveCount,
        fallback_factor_count: fallbackCount,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('[plaid-sync-transactions] uncaught:', err);
    return jsonError(500, (err as Error).message);
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

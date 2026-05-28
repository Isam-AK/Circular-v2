// ============================================================
// plaid-sync-transactions
//
// Pulls the last 30 days of transactions from Plaid for the authenticated
// user, maps each to a CO₂e estimate using the spend-carbon factors in
// _shared/spend-carbon.ts, and upserts them into public.transactions.
// Idempotent via Plaid's stable `transaction_id` (DB column
// `plaid_transaction_id` has a UNIQUE constraint).
//
// After insert, calls recalculate_carbon_score so users.carbon_score
// reflects spending impact alongside mobility logs.
//
// Phase 2 of the Plaid integration. Phase 3 (deferred) would replace the
// hardcoded factors with live Climatiq API estimates.
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { classifyTransaction } from '../_shared/spend-carbon.ts';

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

    // ── Map Plaid txns → DB rows ──
    const rows = transactions.map((t: any) => {
      // Prefer `detailed` (e.g. TRAVEL_FLIGHTS) for the tightest factor; fall
      // back to `primary`, then to the legacy `category[]` array if neither
      // PFC field is present (older Plaid items).
      const detailed: string | null = t.personal_finance_category?.detailed ?? null;
      const primary: string | null =
        t.personal_finance_category?.primary ??
        (Array.isArray(t.category) && t.category.length > 0
          ? t.category[0].toUpperCase().replace(/ /g, '_')
          : null);

      const mapping = classifyTransaction(detailed, primary);

      // Plaid amounts are POSITIVE for outflows (spending) and NEGATIVE for
      // inflows. Carbon is only meaningful for outflows.
      const amount = Number(t.amount);
      const carbonKg = amount > 0 ? Math.round(mapping.kgPerUsd * amount * 10_000) / 10_000 : 0;

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

    return new Response(
      JSON.stringify({
        ok: true,
        fetched: transactions.length,
        upserted,
        total_carbon_kg: Math.round(totalCarbon * 100) / 100,
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

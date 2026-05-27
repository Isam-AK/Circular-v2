// ============================================================
// plaid-exchange-public-token
//
// After the user completes Plaid Link in the app, the SDK calls back
// with a short-lived `public_token`. This function exchanges it for
// the long-lived `access_token` (which authorizes server-side Plaid
// API calls) and the `item_id` (Plaid's identifier for the connection
// to a specific bank). Both are persisted to `public.users` for the
// authenticated user.
//
// Future sync / disconnect / webhook handlers will read access_token
// from here.
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      return jsonError(500, 'Plaid credentials not configured on server');
    }

    const { public_token } = (await req.json()) as { public_token?: string };
    if (!public_token) return jsonError(400, 'public_token required');

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

    // ── Exchange the public_token for access_token + item_id ──
    const plaidRes = await fetch(`${PLAID_BASE}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        public_token,
      }),
    });

    const plaidBody: any = await plaidRes.json();
    if (!plaidRes.ok) {
      console.error('[plaid] /item/public_token/exchange failed:', plaidBody);
      return jsonError(
        plaidRes.status,
        plaidBody.error_message ?? 'Plaid token exchange failed',
      );
    }

    // ── Persist access_token + item_id on the user's row ──
    // We use a service-role client here because RLS on public.users only
    // allows the user to update their *own* row via auth.uid() — which we
    // already verified above. Using service role keeps this from being
    // affected by future RLS changes.
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { error: updateError } = await serviceClient
      .from('users')
      .update({
        plaid_access_token: plaidBody.access_token,
        plaid_item_id: plaidBody.item_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('[plaid] users update failed:', updateError);
      return jsonError(500, 'Failed to persist Plaid tokens');
    }

    return new Response(
      JSON.stringify({ ok: true, item_id: plaidBody.item_id }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('[plaid-exchange-public-token] uncaught:', err);
    return jsonError(500, (err as Error).message);
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

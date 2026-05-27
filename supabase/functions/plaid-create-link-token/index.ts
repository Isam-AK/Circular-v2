// ============================================================
// plaid-create-link-token
//
// Issues a short-lived Plaid Link token that the React Native client
// passes into the Plaid Link SDK. The Link UI uses it to start a bank
// connection flow, and on completion returns a public_token to the
// client — which is then exchanged for a long-lived access_token by
// the sibling Edge Function `plaid-exchange-public-token`.
//
// Why an Edge Function instead of calling Plaid directly from the app:
// PLAID_SECRET must never live in the mobile bundle. Anything that
// touches it stays server-side.
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

    // ── Authenticate caller via the user's Supabase JWT ──
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

    // ── Ask Plaid for a link token tied to this user ──
    const plaidRes = await fetch(`${PLAID_BASE}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        client_name: 'Circular',
        user: { client_user_id: user.id },
        products: ['transactions'],
        country_codes: ['US'],
        language: 'en',
      }),
    });

    const plaidBody: any = await plaidRes.json();
    if (!plaidRes.ok) {
      console.error('[plaid] /link/token/create failed:', plaidBody);
      return jsonError(
        plaidRes.status,
        plaidBody.error_message ?? 'Plaid link-token request failed',
      );
    }

    return new Response(
      JSON.stringify({ link_token: plaidBody.link_token }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    console.error('[plaid-create-link-token] uncaught:', err);
    return jsonError(500, (err as Error).message);
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

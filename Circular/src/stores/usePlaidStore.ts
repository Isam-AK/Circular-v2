import { create as createStore } from 'zustand';
import { create as createPlaidLink, open as openPlaidLink } from 'react-native-plaid-link-sdk';
import type { LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { supabase } from '@/lib/supabase';
import { useUserStore } from '@/stores/useUserStore';
import type { Transaction } from '@/types/database';

/** Result summary returned by the plaid-sync-transactions Edge Function. */
interface SyncSummary {
  fetched: number;
  upserted: number;
  total_carbon_kg: number;
  /** How many rows were scored with a live Climatiq factor. */
  liveFactorCount: number;
  /** How many fell back to the Phase 2 hardcoded factor. */
  fallbackFactorCount: number;
  /** ISO timestamp recorded client-side when the sync completed. */
  at: string;
}

interface PlaidState {
  // ── Phase 1: Connect bank ──
  /** True while a connect attempt is in flight (link-token fetch + Link UI + exchange). */
  busy: boolean;
  error: string | null;
  /** Last successful Plaid item_id (also persisted on users.plaid_item_id). */
  lastItemId: string | null;

  // ── Phase 2: Transaction sync ──
  /** Most recent transactions for the user, newest first. Populated by
   *  fetchRecentTransactions / syncTransactions. */
  transactions: Transaction[];
  /** True while plaid-sync-transactions is in flight. */
  syncing: boolean;
  syncError: string | null;
  /** Last successful sync result (counts + carbon total + when). */
  lastSync: SyncSummary | null;

  /**
   * Kick off the full Plaid Link → exchange → refresh flow. Side effects:
   *   - Fetches a link token from the plaid-create-link-token Edge Function.
   *   - Opens Plaid Link (native modal).
   *   - On success: posts public_token to plaid-exchange-public-token, which
   *     persists access_token + item_id to public.users.
   *   - Calls useUserStore.fetchUser() so the UI picks up the new
   *     plaid_item_id without a manual refresh.
   */
  connectBank: () => Promise<void>;
  clearError: () => void;

  /**
   * Pull the last 30 days of transactions from Plaid, classify them against
   * Climatiq emission factors (server-side), and upsert into
   * public.transactions. After the upsert the server also recalculates
   * users.carbon_score, so this also refreshes the local user.
   */
  syncTransactions: () => Promise<void>;

  /**
   * Load the most recent N transactions from the DB without calling Plaid.
   * Useful on screen mount so the list is populated even before the user
   * taps Sync.
   */
  fetchRecentTransactions: (limit?: number) => Promise<void>;
  clearSyncError: () => void;
}

const DEFAULT_RECENT_LIMIT = 10;

export const usePlaidStore = createStore<PlaidState>((set) => ({
  busy: false,
  error: null,
  lastItemId: null,

  transactions: [],
  syncing: false,
  syncError: null,
  lastSync: null,

  connectBank: async () => {
    set({ busy: true, error: null });

    try {
      // 1. Fetch a Link token from our Edge Function.
      const { data: linkData, error: linkError } = await supabase.functions.invoke(
        'plaid-create-link-token',
        { body: {} },
      );
      if (linkError || !linkData?.link_token) {
        const msg =
          linkError?.message ?? linkData?.error ?? 'Could not get link token';
        set({ busy: false, error: msg });
        return;
      }

      // 2. Open Plaid Link with that token. The SDK uses a two-step API:
      //    create(token) primes the SDK, then open() shows the UI and fires
      //    onSuccess / onExit callbacks.
      createPlaidLink({ token: linkData.link_token, noLoadingState: false });

      await new Promise<void>((resolve) => {
        openPlaidLink({
          onSuccess: async (success: LinkSuccess) => {
            try {
              // 3. Exchange public_token for access_token on the server.
              const { data: exchangeData, error: exchangeError } =
                await supabase.functions.invoke('plaid-exchange-public-token', {
                  body: { public_token: success.publicToken },
                });

              if (exchangeError || !exchangeData?.ok) {
                const msg =
                  exchangeError?.message ??
                  exchangeData?.error ??
                  'Token exchange failed';
                set({ busy: false, error: msg });
                resolve();
                return;
              }

              // 4. Refresh the user profile so plaid_item_id flows back into
              //    the app's reactive state and the UI flips to "Connected".
              await useUserStore.getState().fetchUser();

              set({
                busy: false,
                lastItemId: exchangeData.item_id ?? null,
              });
              resolve();
            } catch (e) {
              set({ busy: false, error: (e as Error).message });
              resolve();
            }
          },
          onExit: (exit: LinkExit) => {
            // User cancelled or hit an in-flow Plaid error. Both are non-fatal
            // — we just stop being busy. Only surface real errors, not
            // intentional cancels.
            const wasCancel = !exit.error;
            set({
              busy: false,
              error: wasCancel ? null : exit.error?.errorMessage ?? null,
            });
            resolve();
          },
        });
      });
    } catch (e) {
      set({ busy: false, error: (e as Error).message });
    }
  },

  clearError: () => set({ error: null }),

  syncTransactions: async () => {
    set({ syncing: true, syncError: null });

    try {
      const { data, error } = await supabase.functions.invoke(
        'plaid-sync-transactions',
        { body: {} },
      );

      if (error || !data?.ok) {
        const msg =
          error?.message ?? data?.error ?? 'Could not sync transactions';
        set({ syncing: false, syncError: msg });
        return;
      }

      // Refresh dependent state in parallel:
      //   - user row (carbon_score changed server-side after upsert)
      //   - the recent-transactions list
      const summary: SyncSummary = {
        fetched: data.fetched ?? 0,
        upserted: data.upserted ?? 0,
        total_carbon_kg: data.total_carbon_kg ?? 0,
        liveFactorCount: data.live_factor_count ?? 0,
        fallbackFactorCount: data.fallback_factor_count ?? 0,
        at: new Date().toISOString(),
      };

      await Promise.all([
        useUserStore.getState().fetchUser(),
        (async () => {
          const { data: rows, error: selectError } = await supabase
            .from('transactions')
            .select('*')
            .order('transaction_date', { ascending: false })
            .limit(DEFAULT_RECENT_LIMIT);
          if (!selectError && rows) {
            set({ transactions: rows as Transaction[] });
          }
        })(),
      ]);

      set({ syncing: false, lastSync: summary });
    } catch (e) {
      set({ syncing: false, syncError: (e as Error).message });
    }
  },

  fetchRecentTransactions: async (limit = DEFAULT_RECENT_LIMIT) => {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('transaction_date', { ascending: false })
      .limit(limit);

    if (error) {
      set({ syncError: error.message });
      return;
    }
    set({ transactions: (data ?? []) as Transaction[] });
  },

  clearSyncError: () => set({ syncError: null }),
}));

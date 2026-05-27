import { create as createStore } from 'zustand';
import { create as createPlaidLink, open as openPlaidLink } from 'react-native-plaid-link-sdk';
import type { LinkSuccess, LinkExit } from 'react-native-plaid-link-sdk';
import { supabase } from '@/lib/supabase';
import { useUserStore } from '@/stores/useUserStore';

interface PlaidState {
  /** True while a connect attempt is in flight (link-token fetch + Link UI + exchange). */
  busy: boolean;
  error: string | null;
  /** Last successful Plaid item_id (also persisted on users.plaid_item_id). */
  lastItemId: string | null;

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
}

export const usePlaidStore = createStore<PlaidState>((set) => ({
  busy: false,
  error: null,
  lastItemId: null,

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
}));

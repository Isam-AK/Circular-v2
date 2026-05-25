import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  session: Session | null;
  /** True once the initial session restore (from AsyncStorage) has completed. */
  initialized: boolean;
  /** Surface auth errors to screens. Cleared on each new attempt. */
  error: string | null;
  /** True while a signIn / signUp / signOut call is in flight. */
  busy: boolean;

  /** Restore session from AsyncStorage and start listening for auth changes. Call once at app boot. */
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  initialized: false,
  error: null,
  busy: false,

  initialize: async () => {
    const { data } = await supabase.auth.getSession();
    set({ session: data.session, initialized: true });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session });
    });
  },

  signIn: async (email, password) => {
    set({ busy: true, error: null });
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      set({ busy: false, error: error.message });
      return;
    }
    set({ busy: false });
    // session is updated by onAuthStateChange listener
  },

  signUp: async (email, password, displayName) => {
    set({ busy: true, error: null });
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          // Read by the handle_new_user() trigger in migration 0001 to seed public.users.display_name
          display_name: displayName.trim(),
        },
      },
    });
    if (error) {
      set({ busy: false, error: error.message });
      return;
    }
    set({ busy: false });
  },

  signOut: async () => {
    set({ busy: true, error: null });
    const { error } = await supabase.auth.signOut();
    if (error) {
      set({ busy: false, error: error.message });
      return;
    }
    set({ busy: false });
  },

  clearError: () => set({ error: null }),
}));

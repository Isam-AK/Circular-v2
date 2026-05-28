import { create } from 'zustand';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

/** What the user-facing forms get back from the auth store. */
interface AuthState {
  session: Session | null;
  /** True once the initial session restore (from AsyncStorage) has completed. */
  initialized: boolean;
  /** Surface auth errors to screens. Cleared on each new attempt. */
  error: string | null;
  /** True while a signIn / signUp / signOut / Apple sign-in call is in flight. */
  busy: boolean;
  /** True while changePassword is in flight (separate so the Profile screen
   *  can show a localized spinner without locking the whole auth UI). */
  changingPassword: boolean;
  /** True while requestPasswordReset is in flight. */
  requestingReset: boolean;

  /** Restore session from AsyncStorage and start listening for auth changes. Call once at app boot. */
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => Promise<void>;

  /**
   * Sign in with Apple using a Supabase-supported identity token. Caller
   * is responsible for calling appleAuth.performRequest() and passing the
   * resulting identityToken + nonce. Session is updated via
   * onAuthStateChange after Supabase verifies the token.
   */
  signInWithApple: (idToken: string, nonce?: string) => Promise<void>;

  /**
   * Change the signed-in user's password. Re-verifies the current password
   * by attempting a fresh signInWithPassword first (Supabase's updateUser
   * doesn't require it natively — we add the check ourselves so a stolen
   * session can't silently rotate the password).
   */
  changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;

  /**
   * Trigger a password-reset email. The recovery link lands on Supabase's
   * hosted recovery page until in-app deep-link recovery ships (follow-up).
   */
  requestPasswordReset: (email: string) => Promise<boolean>;

  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  initialized: false,
  error: null,
  busy: false,
  changingPassword: false,
  requestingReset: false,

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

  signInWithApple: async (idToken, nonce) => {
    if (Platform.OS !== 'ios') {
      set({ error: 'Sign in with Apple is only available on iOS.' });
      return;
    }
    set({ busy: true, error: null });
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: idToken,
      nonce,
    });
    if (error) {
      set({ busy: false, error: error.message });
      return;
    }
    set({ busy: false });
    // The handle_new_user() trigger seeds public.users on first sign-in;
    // for Apple, raw_user_meta_data carries no display_name so the trigger
    // falls back to the email prefix (see migration 0001). Users can
    // edit it from Profile afterwards.
  },

  changePassword: async (currentPassword, newPassword) => {
    set({ changingPassword: true, error: null });

    // Re-verify current password by attempting a fresh password sign-in.
    // The email comes from the current session — passwordless / Apple
    // sign-ins won't have a password to change, so we bail with a clear
    // error there.
    const session = get().session;
    const email = session?.user?.email;
    if (!email) {
      set({
        changingPassword: false,
        error: 'No password is associated with this account. Sign in with email + password to set one.',
      });
      return false;
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (verifyError) {
      set({ changingPassword: false, error: 'Current password is incorrect.' });
      return false;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (updateError) {
      set({ changingPassword: false, error: updateError.message });
      return false;
    }

    set({ changingPassword: false });
    return true;
  },

  requestPasswordReset: async (email) => {
    set({ requestingReset: true, error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    // redirectTo is left as the project's configured Site URL (Supabase
    // dashboard) until we ship the in-app deep-link recovery flow.
    if (error) {
      set({ requestingReset: false, error: error.message });
      return false;
    }
    set({ requestingReset: false });
    return true;
  },

  clearError: () => set({ error: null }),
}));

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { User } from '@/types/database';

interface UserState {
  user: User | null;
  loading: boolean;
  error: string | null;
  fetchUser: () => Promise<void>;
  setUser: (user: User | null) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  loading: false,
  error: null,

  fetchUser: async () => {
    set({ loading: true, error: null });

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      set({ loading: false, error: authError?.message ?? 'Not authenticated' });
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    set({ user: data, loading: false });
  },

  setUser: (user) => set({ user }),
}));

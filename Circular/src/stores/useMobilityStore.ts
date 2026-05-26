import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { carbonForTrip, savingsForTrip } from '@/lib/emissions';
import type { MobilityLog, TransportMode } from '@/types/database';
import { useUserStore } from '@/stores/useUserStore';

interface LogTripInput {
  mode: TransportMode;
  distanceKm: number;
  durationMin?: number;
}

interface MobilityState {
  trips: MobilityLog[];
  /** True while a logTrip / fetchTrips call is in flight. */
  busy: boolean;
  error: string | null;

  /** Insert a new mobility log, recalc carbon_score on the server, refresh user. */
  logTrip: (input: LogTripInput) => Promise<MobilityLog | null>;
  /** Fetch the current user's trips, newest first. */
  fetchTrips: () => Promise<void>;
  clearError: () => void;
}

export const useMobilityStore = create<MobilityState>((set, get) => ({
  trips: [],
  busy: false,
  error: null,

  logTrip: async ({ mode, distanceKm, durationMin }) => {
    set({ busy: true, error: null });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      set({ busy: false, error: authError?.message ?? 'Not authenticated' });
      return null;
    }

    const carbonKg = carbonForTrip(mode, distanceKm);
    const savedKg = savingsForTrip(mode, distanceKm);
    const startedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('mobility_logs')
      .insert({
        user_id: authData.user.id,
        mode,
        distance_km: distanceKm,
        duration_min: durationMin ?? null,
        carbon_kg: carbonKg,
        carbon_saved_kg: savedKg,
        started_at: startedAt,
      })
      .select()
      .single();

    if (error || !data) {
      set({ busy: false, error: error?.message ?? 'Failed to log trip' });
      return null;
    }

    // Re-sum both totals from scratch on the server. Both RPCs SECURITY DEFINER,
    // both idempotent — running them on every insert means users.carbon_score /
    // carbon_saved can never drift from the underlying tables.
    const [{ error: scoreErr }, { error: savedErr }] = await Promise.all([
      supabase.rpc('recalculate_carbon_score', { target_user_id: authData.user.id }),
      supabase.rpc('recalculate_carbon_saved', { target_user_id: authData.user.id }),
    ]);
    if (scoreErr) {
      console.warn('[useMobilityStore] recalculate_carbon_score failed:', scoreErr.message);
    }
    if (savedErr) {
      set({ error: `Trip logged, but savings recalc failed: ${savedErr.message}` });
      console.warn('[useMobilityStore] recalculate_carbon_saved failed:', savedErr.message);
    }

    // Refresh the user store so HomeScreen picks up the new carbon_saved + carbon_score.
    await useUserStore.getState().fetchUser();

    // Prepend the new trip to the local list.
    set({ busy: false, trips: [data, ...get().trips] });
    return data;
  },

  fetchTrips: async () => {
    set({ busy: true, error: null });

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      set({ busy: false, error: 'Not authenticated' });
      return;
    }

    const { data, error } = await supabase
      .from('mobility_logs')
      .select('*')
      .eq('user_id', authData.user.id)
      .order('started_at', { ascending: false });

    if (error) {
      set({ busy: false, error: error.message });
      return;
    }

    set({ busy: false, trips: data ?? [] });
  },

  clearError: () => set({ error: null }),
}));

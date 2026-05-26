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
        started_at: startedAt,
      })
      .select()
      .single();

    if (error || !data) {
      set({ busy: false, error: error?.message ?? 'Failed to log trip' });
      return null;
    }

    // Recompute carbon_score on the server (sums transactions + mobility_logs).
    const { error: recalcError } = await supabase.rpc('recalculate_carbon_score', {
      target_user_id: authData.user.id,
    });
    if (recalcError) {
      console.warn('[useMobilityStore] recalculate_carbon_score failed:', recalcError.message);
    }

    // Add this trip's savings to the user's lifetime total via atomic RPC
    // (see migration 0003_increment_carbon_saved.sql).
    if (savedKg > 0) {
      const { error: incError } = await supabase.rpc('increment_carbon_saved', {
        target_user_id: authData.user.id,
        delta: savedKg,
      });
      if (incError) {
        // Surface this — if the RPC is missing, carbon_saved will never update.
        set({ error: `Trip logged, but savings update failed: ${incError.message}` });
        console.warn('[useMobilityStore] increment_carbon_saved failed:', incError.message);
      }
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

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import {
  findMaterial,
  co2SavedFor,
  moneySavedFor,
} from '@/lib/recycling';
import type { RecyclingLog, RecyclingTotals, RecyclingSource } from '@/types/database';
import { useUserStore } from '@/stores/useUserStore';

const BUCKET = 'recycling-images';

export interface LogRecyclingInput {
  materialKey: string;
  quantity: number;
  source: RecyclingSource;
  /** Optional local file:// (or asset) URI; uploaded before insert. */
  photoUri?: string;
  /** Optional scanned barcode (EAN/UPC). */
  barcode?: string;
}

const EMPTY_TOTALS: RecyclingTotals = {
  co2_saved_kg: 0,
  money_saved_eur: 0,
  item_count: 0,
  log_count: 0,
};

interface RecyclingState {
  logs: RecyclingLog[];
  totals: RecyclingTotals;
  /** True while fetchLogs / fetchTotals is in flight. */
  loading: boolean;
  /** True while logRecycling (incl. photo upload) is in flight. */
  publishing: boolean;
  error: string | null;

  fetchLogs: () => Promise<void>;
  fetchTotals: () => Promise<void>;
  /** Returns the created log, or null on failure (sets `error`). */
  logRecycling: (input: LogRecyclingInput) => Promise<RecyclingLog | null>;
  clearError: () => void;
}

/** Read a file:// (or asset) URI into bytes for storage.upload. */
async function readFileAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  return await res.arrayBuffer();
}

/** supabase-js returns NUMERIC/BIGINT as strings — coerce to real numbers. */
function normalizeLog(row: any): RecyclingLog {
  return {
    ...row,
    quantity: Number(row.quantity),
    co2_saved_kg: Number(row.co2_saved_kg),
    money_saved_eur: Number(row.money_saved_eur),
  } as RecyclingLog;
}

export const useRecyclingStore = create<RecyclingState>((set, get) => ({
  logs: [],
  totals: EMPTY_TOTALS,
  loading: false,
  publishing: false,
  error: null,

  fetchLogs: async () => {
    set({ loading: true, error: null });

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      set({ loading: false, error: 'Not authenticated' });
      return;
    }

    const { data, error } = await supabase
      .from('recycling_logs')
      .select('*')
      .eq('user_id', authData.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }

    set({ loading: false, logs: (data ?? []).map(normalizeLog) });
  },

  fetchTotals: async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    // rpc chain doesn't propagate cleanly in supabase-js v2 (same workaround
    // as useItemStore); cast on the rpc call. Returns a single aggregate row.
    const { data, error } = await (supabase.rpc as any)('recycling_totals', {
      target_user_id: authData.user.id,
    });

    if (error) {
      // Non-fatal: leave whatever totals we had, just surface for debugging.
      console.warn('[useRecyclingStore] recycling_totals failed:', error.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    set({
      totals: {
        co2_saved_kg: Number(row?.co2_saved_kg ?? 0),
        money_saved_eur: Number(row?.money_saved_eur ?? 0),
        item_count: Number(row?.item_count ?? 0),
        log_count: Number(row?.log_count ?? 0),
      },
    });
  },

  logRecycling: async ({ materialKey, quantity, source, photoUri, barcode }) => {
    set({ publishing: true, error: null });

    const material = findMaterial(materialKey);
    if (!material) {
      set({ publishing: false, error: 'Unknown material' });
      return null;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      set({ publishing: false, error: 'Quantity must be at least 1' });
      return null;
    }

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      set({ publishing: false, error: authError?.message ?? 'Not authenticated' });
      return null;
    }
    const uid = authData.user.id;

    // ── Optional photo upload ──
    let photoUrl: string | null = null;
    if (photoUri) {
      try {
        const path = `${uid}/${Date.now()}.jpg`;
        const bytes = await readFileAsArrayBuffer(photoUri);
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
        if (uploadError) throw uploadError;
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        photoUrl = pub.publicUrl;
      } catch (e) {
        set({ publishing: false, error: `Photo upload failed: ${(e as Error).message}` });
        return null;
      }
    }

    // ── Snapshot savings + insert ──
    const co2 = co2SavedFor(material, quantity);
    const money = moneySavedFor(material, quantity);

    // Cast the values arg to bypass supabase-js's `never` Insert inference
    // (same workaround as useItemStore / useMobilityStore).
    const { data: row, error: insertError } = await supabase
      .from('recycling_logs')
      .insert({
        user_id: uid,
        material_key: material.key,
        label: material.label,
        quantity,
        co2_saved_kg: co2,
        money_saved_eur: money,
        source,
        photo_url: photoUrl,
        barcode: barcode ?? null,
      } as any)
      .select()
      .single();

    if (insertError || !row) {
      set({ publishing: false, error: insertError?.message ?? 'Failed to log recycling' });
      return null;
    }

    // Roll the CO₂ into users.carbon_saved (the Home hero metric), same as a
    // trip. SECURITY DEFINER + idempotent, so re-summing on each insert can't
    // drift. Non-fatal if it fails — the row is already saved.
    const { error: recalcErr } = await (supabase.rpc as any)('recalculate_carbon_saved', {
      target_user_id: uid,
    });
    if (recalcErr) {
      console.warn('[useRecyclingStore] recalculate_carbon_saved failed:', recalcErr.message);
    }

    const saved = normalizeLog(row);
    // Refresh dependent state: user store (Home hero) + local list + totals.
    await useUserStore.getState().fetchUser();
    set({ publishing: false, logs: [saved, ...get().logs] });
    await get().fetchTotals();

    return saved;
  },

  clearError: () => set({ error: null }),
}));

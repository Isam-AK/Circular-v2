import { create } from 'zustand';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { SharedItem, ItemCondition, GeoPoint } from '@/types/database';

const BUCKET = 'shared-item-images';

/** Payload for the "list an item to share" flow. */
export interface CreateItemInput {
  title: string;
  description?: string | null;
  condition: ItemCondition;
  tags?: string[];
  /** Local file:// URIs from camera / library; uploaded before insert. */
  photoUris: string[];
  /** Decimal degrees from @react-native-community/geolocation. */
  latitude: number;
  longitude: number;
}

interface NearbyParams {
  latitude: number;
  longitude: number;
  /** Default 5 km — matches the nearby_items RPC default. */
  radiusMeters?: number;
}

interface ItemState {
  /** Items returned by the latest fetchNearby() call, newest first. */
  nearby: SharedItem[];
  /** True while fetchNearby is in flight. */
  loading: boolean;
  /** True while createItem (incl. photo uploads) is in flight. */
  publishing: boolean;
  error: string | null;

  fetchNearby: (params: NearbyParams) => Promise<void>;
  /** Returns the created item, or null on failure (sets `error`). */
  createItem: (input: CreateItemInput) => Promise<SharedItem | null>;
  clearError: () => void;
}

/** Read a `file://` URI into an ArrayBuffer for supabase.storage.upload. */
async function readFileAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  // React Native's fetch supports file:// URIs natively. .arrayBuffer()
  // gives us the raw bytes Supabase Storage wants — Blob is finicky
  // across RN versions, ArrayBuffer is consistent.
  const res = await fetch(uri);
  return await res.arrayBuffer();
}

/** Build a stable storage path: <ownerId>/<timestamp>_<i>.jpg */
function storagePathFor(ownerId: string, index: number): string {
  const ts = Date.now();
  return `${ownerId}/${ts}_${index}.jpg`;
}

export const useItemStore = create<ItemState>((set) => ({
  nearby: [],
  loading: false,
  publishing: false,
  error: null,

  fetchNearby: async ({ latitude, longitude, radiusMeters = 5000 }) => {
    set({ loading: true, error: null });

    // `rpc` is typed as accepting only RPCs declared in the Database
    // type map. The chain doesn't propagate cleanly in supabase-js v2.6+
    // (same issue useMobilityStore works around), so we cast on the
    // RPC name. The runtime call is unaffected.
    const { data, error } = await (supabase.rpc as any)('nearby_items', {
      lat: latitude,
      lng: longitude,
      radius_m: radiusMeters,
    });

    if (error) {
      set({ loading: false, error: error.message });
      return;
    }
    set({ loading: false, nearby: (data ?? []) as SharedItem[] });
  },

  createItem: async (input) => {
    set({ publishing: true, error: null });

    // 1. Who's calling? We need the auth.uid() for both the storage
    //    path prefix (RLS) and the owner_id column on shared_items.
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      set({ publishing: false, error: authError?.message ?? 'Not authenticated' });
      return null;
    }
    const ownerId = authData.user.id;

    // 2. Upload each photo. We do them in parallel — small photos,
    //    no server-side throttle on Storage.
    let uploadedUrls: string[] = [];
    try {
      uploadedUrls = await Promise.all(
        input.photoUris.map(async (uri, i) => {
          const path = storagePathFor(ownerId, i);
          const bytes = await readFileAsArrayBuffer(uri);
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(path, bytes, {
              contentType: 'image/jpeg',
              upsert: false,
            });
          if (uploadError) throw uploadError;
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
          return pub.publicUrl;
        }),
      );
    } catch (e) {
      const msg = `Photo upload failed: ${(e as Error).message}`;
      set({ publishing: false, error: msg });
      return null;
    }

    // 3. Insert the item row. The DB enforces NOT NULL on location,
    //    so we always include it. geography(POINT,4326) accepts a
    //    GeoJSON-style {type, coordinates} via PostgREST.
    const locationGeoJson: GeoPoint = {
      type: 'Point',
      coordinates: [input.longitude, input.latitude],
    };

    // Same supabase-js Database-type propagation issue as the
    // useMobilityStore insert — cast the values arg to bypass the
    // `never` inference. PostgREST happily takes the GeoJSON point.
    const { data: row, error: insertError } = await supabase
      .from('shared_items')
      .insert({
        owner_id: ownerId,
        title: input.title,
        description: input.description ?? null,
        image_urls: uploadedUrls,
        condition: input.condition,
        location: locationGeoJson,
        tags: input.tags ?? [],
      } as any)
      .select()
      .single();

    if (insertError || !row) {
      set({
        publishing: false,
        error: insertError?.message ?? 'Failed to create item',
      });
      return null;
    }

    set({ publishing: false });
    return row as SharedItem;
  },

  clearError: () => set({ error: null }),
}));

/** Platform-aware helper so callers don't reach into Platform themselves. */
export const isIOS = Platform.OS === 'ios';

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { User } from '@/types/database';

const AVATAR_BUCKET = 'user-avatars';

interface UpdateProfileInput {
  display_name?: string;
  /** A local file:// URI (from camera). Uploaded to user-avatars,
   *  the resulting public URL is then persisted to users.avatar_url. */
  avatarPhotoUri?: string;
}

interface UserState {
  user: User | null;
  loading: boolean;
  /** True while updateProfile is in flight. */
  saving: boolean;
  error: string | null;
  fetchUser: () => Promise<void>;
  /**
   * Patch the signed-in user's row in public.users. Pass either a new
   * display_name, an avatarPhotoUri (which uploads + sets avatar_url),
   * or both. Returns the updated User on success, null otherwise.
   */
  updateProfile: (input: UpdateProfileInput) => Promise<User | null>;
  setUser: (user: User | null) => void;
}

/** Read a file:// URI into bytes for storage.upload. */
async function readFileAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  return await res.arrayBuffer();
}

export const useUserStore = create<UserState>((set, get) => ({
  user: null,
  loading: false,
  saving: false,
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

  updateProfile: async ({ display_name, avatarPhotoUri }) => {
    set({ saving: true, error: null });

    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      set({ saving: false, error: authError?.message ?? 'Not authenticated' });
      return null;
    }
    const uid = authData.user.id;

    // ── Avatar upload (optional) ──
    let nextAvatarUrl: string | undefined;
    if (avatarPhotoUri) {
      try {
        // Single fixed path so re-uploads overwrite (upsert) and the URL
        // stays stable across changes. The CDN may cache the old image,
        // so we cache-bust via `?v=<timestamp>` below when we persist.
        const path = `${uid}/avatar.jpg`;
        const bytes = await readFileAsArrayBuffer(avatarPhotoUri);
        const { error: uploadError } = await supabase.storage
          .from(AVATAR_BUCKET)
          .upload(path, bytes, {
            contentType: 'image/jpeg',
            upsert: true,
          });
        if (uploadError) throw uploadError;
        const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
        // Append a version param so React Native's Image cache invalidates.
        nextAvatarUrl = `${pub.publicUrl}?v=${Date.now()}`;
      } catch (e) {
        set({ saving: false, error: `Avatar upload failed: ${(e as Error).message}` });
        return null;
      }
    }

    // ── Patch the users row ──
    // Build the patch dynamically so we don't blank out unchanged
    // columns (and so an empty patch becomes a no-op).
    const patch: Partial<Pick<User, 'display_name' | 'avatar_url'>> = {};
    if (display_name !== undefined && display_name !== get().user?.display_name) {
      patch.display_name = display_name;
    }
    if (nextAvatarUrl !== undefined) {
      patch.avatar_url = nextAvatarUrl;
    }

    if (Object.keys(patch).length === 0) {
      // Nothing to persist (e.g. user opened the editor and saved without
      // changes). Treat as success — caller can dismiss any modal.
      set({ saving: false });
      return get().user;
    }

    // Same supabase-js Database-type propagation workaround as the
    // sibling stores. Cast the .from() chain rather than the patch
    // arg — `.update()`'s `never` parameter blocks the `as any` cast
    // on the arg itself in this typings shape.
    const { data: row, error: updateError } = await (supabase.from('users') as any)
      .update(patch)
      .eq('id', uid)
      .select()
      .single();

    if (updateError || !row) {
      set({ saving: false, error: updateError?.message ?? 'Profile update failed' });
      return null;
    }

    set({ saving: false, user: row as User });
    return row as User;
  },

  setUser: (user) => set({ user }),
}));

-- ============================================================
-- Circular — Storage bucket + RLS for user avatars
-- Idempotent: safe to re-run.
-- ============================================================
--
-- One avatar per user, written to user-avatars/<uid>/avatar.jpg.
-- The single fixed filename means re-uploads overwrite in place,
-- so users.avatar_url can be a stable URL and the CDN cache just
-- gets bumped via a `?v=<timestamp>` query string client-side
-- (handled by useUserStore.updateProfile).
--
-- Public-read so <Image source={{ uri }} /> works without signed
-- URLs across the Share tab, Profile, and any future leaderboard.
-- Owner-only writes via the same storage.foldername(name)[1] =
-- auth.uid() pattern that 0007 uses for shared-item-images.

-- ------------------------------------------------------------
-- 1. Bucket
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-avatars', 'user-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ------------------------------------------------------------
-- 2. Policies on storage.objects (scoped to bucket_id = 'user-avatars')
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can read user avatars"
  ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Users can replace own avatar"
  ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own avatar"
  ON storage.objects;

CREATE POLICY "Anyone can read user avatars"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'user-avatars');

CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can replace own avatar"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'user-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'user-avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ------------------------------------------------------------
-- Verification (read-only):
--   SELECT id, public FROM storage.buckets WHERE id = 'user-avatars';
--   SELECT policyname FROM pg_policies
--     WHERE schemaname = 'storage' AND tablename = 'objects'
--       AND policyname LIKE '%avatar%';
-- ------------------------------------------------------------

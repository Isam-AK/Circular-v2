-- ============================================================
-- Circular — Storage bucket + RLS for shared item photos
-- Idempotent: safe to re-run.
-- ============================================================
--
-- The Share feature lets users post items for hyper-local re-use.
-- Each item carries up to a few photos (shared_items.image_urls TEXT[]).
-- This migration creates the bucket they live in and the policies
-- that let:
--   - Authenticated users upload into a folder named after their UID
--     (e.g. <uid>/<timestamp>.jpg), and nowhere else.
--   - Anyone read any photo in the bucket (the URLs go in
--     image_urls without signing, and the Share tab needs unauthed-
--     friendly URLs for performance).
--   - Owners delete / replace their own photos.
--
-- The bucket is created public-read so getPublicUrl() returns a
-- URL that loads without an auth header. RLS on storage.objects
-- still enforces the per-owner write rules.

-- ------------------------------------------------------------
-- 1. Bucket
-- ------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('shared-item-images', 'shared-item-images', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ------------------------------------------------------------
-- 2. Policies on storage.objects
--    Each is scoped to bucket_id = 'shared-item-images' so other
--    buckets are unaffected.
-- ------------------------------------------------------------

-- Drop-and-recreate makes the migration safely re-runnable when
-- policy bodies change.

DROP POLICY IF EXISTS "Anyone can read shared item photos"
  ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to own folder"
  ON storage.objects;
DROP POLICY IF EXISTS "Owners can update own shared item photos"
  ON storage.objects;
DROP POLICY IF EXISTS "Owners can delete own shared item photos"
  ON storage.objects;

CREATE POLICY "Anyone can read shared item photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'shared-item-images');

-- The owner's UID is the first path segment. We compare it to the
-- caller's auth.uid() (cast to text since storage.objects.name is
-- text). Path parsing via storage.foldername is the recommended
-- Supabase pattern.
CREATE POLICY "Authenticated users can upload to own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'shared-item-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can update own shared item photos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'shared-item-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can delete own shared item photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'shared-item-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ------------------------------------------------------------
-- Verification (read-only):
--   SELECT id, public FROM storage.buckets WHERE id = 'shared-item-images';
--   SELECT policyname FROM pg_policies
--     WHERE schemaname = 'storage' AND tablename = 'objects'
--     ORDER BY policyname;
-- ------------------------------------------------------------

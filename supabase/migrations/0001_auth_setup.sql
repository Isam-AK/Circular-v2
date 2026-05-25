-- ============================================================
-- Circular — Auth setup migration
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. INSERT policy on public.users
--    Allows a freshly-signed-up user to create their own profile row.
--    Required because the master schema only has SELECT + UPDATE policies.
-- ------------------------------------------------------------

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

CREATE POLICY "Users can insert own profile"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ------------------------------------------------------------
-- 2. handle_new_user() trigger
--    Auto-creates a row in public.users whenever a new row appears in
--    auth.users. Pulls display_name from raw_user_meta_data which the
--    SignUpScreen passes in supabase.auth.signUp({ options: { data: { display_name } } }).
--    Falls back to the email local-part if display_name is missing
--    (safety net for users created via the Supabase dashboard).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- 3. Quick verification (read-only, safe)
-- ------------------------------------------------------------

-- Confirms the trigger is registered:
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'on_auth_user_created';
--
-- Confirms the INSERT policy exists:
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.users'::regclass AND polcmd = 'a';

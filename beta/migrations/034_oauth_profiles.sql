-- ─── MIGRATION 034 — OAuth profile fields ───────────────────────────────────
--
-- Adds the columns a Google account brings with it, and teaches the signup
-- trigger to read them. Nothing about authorisation changes: role still lives
-- on user_profiles, is_admin() still resolves through auth.uid(), and
-- can_access_feature() is untouched. A Google user and an email user are the
-- same row shape to every check downstream — which is the point.
--
-- Touches no intelligence table.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  -- 'email' | 'google' | whatever Supabase reports. Text rather than an enum so
  -- adding a provider is a config change, not a migration.
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

COMMENT ON COLUMN public.user_profiles.provider IS
  'Auth provider from auth.users.raw_app_meta_data. Descriptive only — never used to authorise. Authorisation reads role, keyed on auth.uid().';

-- ── Signup trigger, now reading OAuth metadata ──────────────────────────────
-- Google puts the display name under full_name or name, and the picture under
-- avatar_url or picture, depending on the scope granted. Both spellings are
-- checked so a profile is never created without a name when one was supplied.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, display_name, avatar_url, provider, last_login_at)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'display_name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

/**
 * Records a sign-in and backfills anything the provider supplies that the
 * profile is still missing.
 *
 * Called after every successful sign-in, including email. It only fills NULLs:
 * a display name the user has since edited is never overwritten by whatever
 * Google last returned.
 */
CREATE OR REPLACE FUNCTION public.touch_last_login(p_user uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
  v_app  jsonb;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;

  SELECT raw_user_meta_data, raw_app_meta_data INTO v_meta, v_app
  FROM auth.users WHERE id = p_user;

  -- A row should already exist via the trigger; this covers accounts created
  -- before 033 shipped.
  INSERT INTO public.user_profiles (user_id, display_name, avatar_url, provider, last_login_at)
  VALUES (
    p_user,
    COALESCE(v_meta->>'full_name', v_meta->>'name', v_meta->>'display_name'),
    COALESCE(v_meta->>'avatar_url', v_meta->>'picture'),
    COALESCE(v_app->>'provider', 'email'),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    last_login_at = now(),
    display_name  = COALESCE(public.user_profiles.display_name, EXCLUDED.display_name),
    avatar_url    = COALESCE(public.user_profiles.avatar_url, EXCLUDED.avatar_url),
    provider      = COALESCE(public.user_profiles.provider, EXCLUDED.provider),
    updated_at    = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_login(uuid) TO authenticated;

-- ── Backfill existing accounts ──────────────────────────────────────────────
UPDATE public.user_profiles p
   SET provider   = COALESCE(p.provider, u.raw_app_meta_data->>'provider', 'email'),
       avatar_url = COALESCE(p.avatar_url,
                             u.raw_user_meta_data->>'avatar_url',
                             u.raw_user_meta_data->>'picture'),
       display_name = COALESCE(p.display_name,
                               u.raw_user_meta_data->>'full_name',
                               u.raw_user_meta_data->>'name',
                               split_part(COALESCE(u.email, ''), '@', 1))
  FROM auth.users u
 WHERE u.id = p.user_id
   AND (p.provider IS NULL OR p.avatar_url IS NULL OR p.display_name IS NULL);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Unchanged. up_self_update from 033 already restricts a self-update to
-- role = 'user', so a user may edit their own display name or avatar but
-- cannot promote themselves regardless of which provider they signed in with.

-- ── Google OAuth setup, outside SQL ─────────────────────────────────────────
-- 1. Supabase dashboard -> Authentication -> Providers -> Google: enable, and
--    paste the client id and secret from Google Cloud Console.
-- 2. Google Cloud Console -> Credentials -> OAuth client -> Authorised redirect
--    URI: https://<project-ref>.supabase.co/auth/v1/callback
-- 3. Supabase -> Authentication -> URL Configuration -> Redirect URLs: add the
--    app's own callback, e.g. https://mybroker.ug/pitch/auth/callback
--    (the basePath matters — omitting /pitch sends users to a 404 on return).
--
-- No credential belongs in this file or in the repository.

-- ── Rollback ────────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.touch_last_login(uuid);
--   ALTER TABLE public.user_profiles
--     DROP COLUMN IF EXISTS avatar_url,
--     DROP COLUMN IF EXISTS provider,
--     DROP COLUMN IF EXISTS last_login_at;
--   -- then re-apply the handle_new_user() definition from migration 033.

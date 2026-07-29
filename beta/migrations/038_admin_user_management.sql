-- ─── MIGRATION 038 — Admin user management ──────────────────────────────────
--
-- Role hierarchy, suspension, an admin action audit trail, and an email
-- column on user_profiles. Touches no intelligence table.
--
-- WHAT THIS DOES NOT BUILD, AND WHY
-- Usage analytics (matches viewed, searches, API calls) need an event-capture
-- table nothing writes to yet — adding the schema without a writer would just
-- be an empty table pretending to be a feature. Session history beyond
-- last_login_at (IP, browser, device, per-login timeline) needs the same.
-- Both are real, buildable features; neither belongs in a migration that
-- can't populate them.

-- ── 1. Role hierarchy ────────────────────────────────────────────────────────
-- Owner ranks above admin so is_admin() keeps working unmodified for every
-- existing "admin-only" check — an owner is a superset of admin, not a
-- parallel track. rank() below is what orders the other four for promotion
-- and permission checks.
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('user', 'support', 'moderator', 'admin', 'owner'));

CREATE OR REPLACE FUNCTION public.role_rank(p_role text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'moderator' THEN 2
    WHEN 'support' THEN 1
    ELSE 0
  END;
$$;

-- is_admin() (033) checked role = 'admin' literally, which an owner would
-- fail. Owner must be a strict superset of admin everywhere admin already
-- works, so this widens the ONE existing check rather than adding a second,
-- parallel is_owner() that every admin-only policy would need updating to
-- also accept.
CREATE OR REPLACE FUNCTION public.is_admin(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = p_user AND role IN ('admin', 'owner')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_owner(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_profiles WHERE user_id = p_user AND role = 'owner');
$$;

CREATE OR REPLACE FUNCTION public.staff_role(p_user uuid DEFAULT auth.uid())
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE user_id = p_user;
$$;

-- ── 2. Suspension ────────────────────────────────────────────────────────────
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS suspended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id);

-- ── 3. Email, mirrored from auth.users ──────────────────────────────────────
-- auth.users is not readable through the authenticated role, and making it
-- readable was rejected earlier for exactly that reason. Mirroring email at
-- signup/login time (the same pattern already used for display_name, avatar
-- and provider) gives admin search a real column without widening access to
-- the auth table itself. This is the resolution to the same tension noted in
-- migration 034's admin user list, which shipped without email for that
-- reason.
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email, display_name, avatar_url, provider, last_login_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'display_name',
      split_part(COALESCE(NEW.email, ''), '@', 1)
    ),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_last_login(p_user uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_meta jsonb; v_app jsonb; v_email text;
BEGIN
  IF p_user IS NULL THEN RETURN; END IF;
  SELECT raw_user_meta_data, raw_app_meta_data, email INTO v_meta, v_app, v_email
  FROM auth.users WHERE id = p_user;

  INSERT INTO public.user_profiles (user_id, email, display_name, avatar_url, provider, last_login_at)
  VALUES (
    p_user, v_email,
    COALESCE(v_meta->>'full_name', v_meta->>'name', v_meta->>'display_name'),
    COALESCE(v_meta->>'avatar_url', v_meta->>'picture'),
    COALESCE(v_app->>'provider', 'email'),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    last_login_at = now(),
    email          = COALESCE(public.user_profiles.email, EXCLUDED.email),
    display_name   = COALESCE(public.user_profiles.display_name, EXCLUDED.display_name),
    avatar_url     = COALESCE(public.user_profiles.avatar_url, EXCLUDED.avatar_url),
    provider       = COALESCE(public.user_profiles.provider, EXCLUDED.provider),
    updated_at     = now();
END;
$$;

-- Backfill existing accounts' email the same way 034 backfilled the others.
UPDATE public.user_profiles p
   SET email = u.email
  FROM auth.users u
 WHERE u.id = p.user_id AND p.email IS NULL;

-- ── 4. Admin action audit trail ─────────────────────────────────────────────
-- What the Activity Timeline and Activity Log Table actually render. Every
-- promote/demote/suspend/unsuspend/plan-change writes one row here. It cannot
-- backfill history for actions taken before this migration — "Created
-- account" for an existing user is still answerable from created_at, but a
-- suspension from last month with no row here simply predates the log, the
-- same way any audit trail has a start date.
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id bigint GENERATED ALWAYS AS IDENTITY,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'role_changed', 'suspended', 'unsuspended',
    'plan_upgraded', 'plan_downgraded', 'plan_cancelled', 'plan_extended', 'plan_reset',
    'note_added'
  )),
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_actions_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_target
  ON public.admin_actions(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_actions_actor
  ON public.admin_actions(actor_id, created_at DESC);

-- ── 5. Internal notes and flags ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_notes (
  id bigint GENERATED ALWAYS AS IDENTITY,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id),
  note text NOT NULL,
  flag text CHECK (flag IS NULL OR flag IN ('suspicious', 'chargeback', 'support_priority', 'vip')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_notes_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_user_notes_target ON public.user_notes(target_user_id, created_at DESC);

-- ── 6. RLS — additive over what 033 already enforces, ONE REAL FIX ──────────
--
-- up_self_update's WITH CHECK from 033 is `(user_id = auth.uid() AND
-- role = 'user') OR is_admin()`. That was fine under the old binary role set,
-- where only a plain 'user' could ever reach the self-branch at all. Under
-- this migration's wider hierarchy it is a bug: a support or moderator
-- account doing nothing more than updating their own display_name has a
-- self-update whose NEW row still carries role = 'support' (unchanged, not
-- touched by the update) — `role = 'user'` evaluates false, is_admin() is
-- false for a moderator, and RLS silently rejects the write. Caught by
-- re-reading the actual policy text rather than trusting the comment already
-- next to it, which asserted this was handled and was wrong the moment a
-- third role value existed.
--
-- Fixed by moving the guard to a trigger, which can compare OLD vs NEW
-- directly instead of asserting a fixed literal — the standard pattern for
-- "you may edit your row, but not these columns" and the reason it wasn't
-- attempted as a WITH CHECK expression this time.
DROP POLICY IF EXISTS up_self_update ON public.user_profiles;
CREATE POLICY up_self_update ON public.user_profiles FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_profile_self_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.suspended IS DISTINCT FROM OLD.suspended
     OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
     OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by
  THEN
    RAISE EXCEPTION 'Only an admin may change role or suspension state.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_self_update ON public.user_profiles;
CREATE TRIGGER guard_profile_self_update
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_self_update();

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notes    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_actions_read ON public.admin_actions;
CREATE POLICY admin_actions_read ON public.admin_actions FOR SELECT
  USING (public.is_admin());
DROP POLICY IF EXISTS admin_actions_insert ON public.admin_actions;
CREATE POLICY admin_actions_insert ON public.admin_actions FOR INSERT
  WITH CHECK (public.is_admin() AND actor_id = auth.uid());
-- No UPDATE, no DELETE policy for anyone: an audit trail that can be edited
-- after the fact is not an audit trail.

DROP POLICY IF EXISTS user_notes_read ON public.user_notes;
CREATE POLICY user_notes_read ON public.user_notes FOR SELECT
  USING (public.is_admin());
DROP POLICY IF EXISTS user_notes_insert ON public.user_notes;
CREATE POLICY user_notes_insert ON public.user_notes FOR INSERT
  WITH CHECK (public.is_admin() AND author_id = auth.uid());

GRANT SELECT, INSERT ON public.admin_actions, public.user_notes TO authenticated;
GRANT EXECUTE ON FUNCTION public.role_rank(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_role(uuid) TO authenticated;

-- ── 7. Promote the first owner ───────────────────────────────────────────────
-- No password in SQL, same as 033's first-admin instruction. Run once,
-- against an account that has already signed up:
--
--   UPDATE public.user_profiles SET role = 'owner', updated_at = now()
--    WHERE user_id = (SELECT id FROM auth.users WHERE email = 'OWNER_EMAIL');
--
-- Existing 'admin' rows from before this migration are unaffected — is_admin()
-- already accepts them, and nothing here demotes anyone.

-- ── Rollback ────────────────────────────────────────────────────────────────
--   DROP POLICY IF EXISTS admin_actions_read ON public.admin_actions;
--   DROP POLICY IF EXISTS admin_actions_insert ON public.admin_actions;
--   DROP POLICY IF EXISTS user_notes_read ON public.user_notes;
--   DROP POLICY IF EXISTS user_notes_insert ON public.user_notes;
--   DROP TABLE IF EXISTS public.admin_actions, public.user_notes;
--   ALTER TABLE public.user_profiles
--     DROP COLUMN IF EXISTS suspended, DROP COLUMN IF EXISTS suspended_reason,
--     DROP COLUMN IF EXISTS suspended_at, DROP COLUMN IF EXISTS suspended_by,
--     DROP COLUMN IF EXISTS email;
--   DROP FUNCTION IF EXISTS public.role_rank(text);
--   DROP FUNCTION IF EXISTS public.is_owner(uuid);
--   DROP FUNCTION IF EXISTS public.staff_role(uuid);
--   -- then restore is_admin()/handle_new_user()/touch_last_login() from 033/034,
--   -- and the 033 role CHECK constraint (role IN ('user','admin')).

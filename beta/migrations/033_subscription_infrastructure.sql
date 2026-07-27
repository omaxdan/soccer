-- ─── MIGRATION 033 — Subscription infrastructure ────────────────────────────
--
-- Builds the subscription layer WITHOUT switching it on. Everything here is
-- inert until platform_settings.subscriptions_enabled flips to true, and the
-- seed sets it to false.
--
-- READ THIS BEFORE ENABLING
-- ─────────────────────────
-- The application has no authentication today: no Supabase Auth session, no
-- @supabase/ssr, no auth.uid() on any request. It reads with the anon key.
--
-- That is fine while the flag is false, because the access service short-
-- circuits to "allow" and never asks who the user is. The moment the flag is
-- true, every request has auth.uid() = NULL, which resolves to the Free tier
-- with no way to sign in and no way to become admin. Turning this on before
-- auth is wired locks the whole platform to Free for everyone, permanently,
-- including whoever needs to turn it back off.
--
-- The toggle is therefore deliberately NOT reachable from the UI without an
-- admin session. Flip it in SQL only, and only after auth exists.
--
-- Touches no intelligence table. No match, team or module calculation is
-- affected by anything in this file.

-- ── 1. Global feature flags ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id bigint GENERATED ALWAYS AS IDENTITY,
  key text NOT NULL UNIQUE,
  value text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_pkey PRIMARY KEY (id)
);

COMMENT ON TABLE public.platform_settings IS
  'Global flags. Values are text so a flag can later hold something other than a boolean without a migration.';

INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'subscriptions_enabled',
  'false',
  'Controls whether subscription restrictions are active. FALSE = beta mode, everyone has full access. Do not set true until Supabase Auth is wired into the frontend: with no session, auth.uid() is NULL, every visitor resolves to Free, and nobody can sign in to turn it back off.'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Plans ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id bigint GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  price numeric NOT NULL DEFAULT 0,
  billing_interval text NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('month', 'year', 'once')),
  active boolean NOT NULL DEFAULT true,
  -- Ordering for gate comparisons. Higher clears everything below it, so a new
  -- tier slots in without touching the comparison logic.
  rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_plans_pkey PRIMARY KEY (id)
);

INSERT INTO public.subscription_plans (name, slug, description, price, rank) VALUES
  ('Free', 'free', 'Match discovery and the five open intelligence modules.', 0, 0),
  ('Pro',  'pro',  'All 13 modules, full evidence breakdown and complete reports.', 19, 10)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Profiles — extends auth.users, never duplicates it ───────────────────
-- No password, no email, no credential of any kind. Supabase Auth owns those.
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_user ON public.user_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);

-- A profile appears automatically on signup, so no code path can create a user
-- that the permission checks cannot see.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 4. Subscriptions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id bigint NOT NULL REFERENCES public.subscription_plans(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'expired', 'past_due')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_subscriptions_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_user_subs_user ON public.user_subscriptions(user_id);

-- At most one live subscription per user. Without this, two active rows make
-- "which plan is this user on" ambiguous and the gate answers inconsistently.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subs_one_active
  ON public.user_subscriptions(user_id) WHERE status = 'active';

-- ── 5. Feature permissions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_permissions (
  id bigint GENERATED ALWAYS AS IDENTITY,
  feature_key text NOT NULL UNIQUE,
  feature_name text NOT NULL,
  required_plan text NOT NULL REFERENCES public.subscription_plans(slug),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_permissions_pkey PRIMARY KEY (id)
);

-- The free set matches the five modules the product already treats as open
-- (1, 5, 7, 8, 10), so enabling the flag changes nothing about which modules
-- are free — it only moves the decision from code into the database.
INSERT INTO public.feature_permissions (feature_key, feature_name, required_plan, description) VALUES
  ('HOME_AWAY_SPLIT',          'Home/Away Split',          'free', 'Home-reliant or road warrior?'),
  ('TRAVEL_IMPACT',            'Travel Impact',            'free', 'Does distance matter here?'),
  ('LEAGUE_GOAL_PROFILE',      'League Goal Profile',      'free', 'Over or under league?'),
  ('FORM_GAP_ACCURACY',        'Form Gap Accuracy',        'free', 'How reliable is this form gap?'),
  ('CONFIDENCE_CALIBRATION',   'Confidence Calibration',   'free', 'Can this pick be trusted?'),
  ('READINESS_TRACKER',        'Readiness Tracker',        'pro',  'Peaking or crashing?'),
  ('CONSISTENCY_INDEX',        'Consistency Index',        'pro',  'Predictable or volatile?'),
  ('GIANT_KILLER_INDEX',       'Giant Killer Index',       'pro',  'Steps up against top teams?'),
  ('REST_ADVANTAGE',           'Rest Advantage',           'pro',  'Is a rest gap worth an edge?'),
  ('BTTS_BY_FATIGUE',          'BTTS by Fatigue',          'pro',  'Is BTTS rest-driven here?'),
  ('HALF_TIME_TRENDS',         'Half-Time Trends',         'pro',  'Any HT/FT pattern?'),
  ('CLEAN_SHEET_PROBABILITY',  'Clean Sheet Probability',  'pro',  'How likely is a clean sheet?'),
  ('WEATHER_IMPACT',           'Weather Impact',           'pro',  'Do the conditions move goals or the result?')
ON CONFLICT (feature_key) DO NOTHING;

-- ── 6. Helpers ──────────────────────────────────────────────────────────────
-- SECURITY DEFINER so a policy can call them without the caller needing read
-- access to the table the policy is protecting.

CREATE OR REPLACE FUNCTION public.is_admin(p_user uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = p_user AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.subscriptions_enabled()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value = 'true' FROM public.platform_settings WHERE key = 'subscriptions_enabled'),
    false
  );
$$;

/**
 * The single source of truth for access. The service layer calls this rather
 * than reimplementing the rule, so there is one place the answer comes from.
 */
CREATE OR REPLACE FUNCTION public.can_access_feature(
  p_feature text,
  p_user uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_required text;
  v_required_rank integer;
  v_user_rank integer;
BEGIN
  -- Beta mode: nobody is checked, and an unknown feature key is not a lockout.
  IF NOT public.subscriptions_enabled() THEN RETURN true; END IF;
  IF public.is_admin(p_user) THEN RETURN true; END IF;

  SELECT required_plan INTO v_required
  FROM public.feature_permissions WHERE feature_key = p_feature;

  -- An unregistered feature is open. Failing closed here would mean every new
  -- module ships invisible until someone remembers to seed a row.
  IF v_required IS NULL THEN RETURN true; END IF;

  SELECT rank INTO v_required_rank
  FROM public.subscription_plans WHERE slug = v_required;

  SELECT COALESCE(MAX(p.rank), 0) INTO v_user_rank
  FROM public.user_subscriptions s
  JOIN public.subscription_plans p ON p.id = s.plan_id
  WHERE s.user_id = p_user
    AND s.status = 'active'
    AND (s.expires_at IS NULL OR s.expires_at > now());

  RETURN v_user_rank >= COALESCE(v_required_rank, 0);
END;
$$;

-- ── 7. Row level security ───────────────────────────────────────────────────
ALTER TABLE public.platform_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions   ENABLE ROW LEVEL SECURITY;

-- Flags, plans and the permission map are readable by everyone: the client has
-- to know whether the system is on and what a feature costs in order to render
-- an upgrade prompt. None of them contain user data.
DROP POLICY IF EXISTS ps_read ON public.platform_settings;
CREATE POLICY ps_read ON public.platform_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS ps_admin_write ON public.platform_settings;
CREATE POLICY ps_admin_write ON public.platform_settings FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS sp_read ON public.subscription_plans;
CREATE POLICY sp_read ON public.subscription_plans FOR SELECT USING (true);
DROP POLICY IF EXISTS sp_admin_write ON public.subscription_plans;
CREATE POLICY sp_admin_write ON public.subscription_plans FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS fp_read ON public.feature_permissions;
CREATE POLICY fp_read ON public.feature_permissions FOR SELECT USING (true);
DROP POLICY IF EXISTS fp_admin_write ON public.feature_permissions;
CREATE POLICY fp_admin_write ON public.feature_permissions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Profiles and subscriptions are per-user. Own row, or admin.
DROP POLICY IF EXISTS up_self_read ON public.user_profiles;
CREATE POLICY up_self_read ON public.user_profiles FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS up_self_update ON public.user_profiles;
CREATE POLICY up_self_update ON public.user_profiles FOR UPDATE
  USING (user_id = auth.uid() OR public.is_admin())
  -- Role is deliberately excluded from what a user may change about themselves;
  -- the WITH CHECK keeps a self-update from writing role = 'admin'.
  WITH CHECK ((user_id = auth.uid() AND role = 'user') OR public.is_admin());
DROP POLICY IF EXISTS up_admin_all ON public.user_profiles;
CREATE POLICY up_admin_all ON public.user_profiles FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS us_self_read ON public.user_subscriptions;
CREATE POLICY us_self_read ON public.user_subscriptions FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS us_admin_all ON public.user_subscriptions;
CREATE POLICY us_admin_all ON public.user_subscriptions FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.platform_settings, public.subscription_plans,
                public.feature_permissions TO anon, authenticated;
GRANT SELECT ON public.user_profiles, public.user_subscriptions TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_feature(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscriptions_enabled() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- ── 8. Creating the first admin ─────────────────────────────────────────────
-- No password appears in SQL. The user must exist in auth.users first, created
-- through Supabase Auth (dashboard, or an invite), and is then promoted:
--
--   UPDATE public.user_profiles SET role = 'admin', updated_at = now()
--   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@example.com');
--
-- Verify:
--   SELECT u.email, p.role FROM public.user_profiles p
--   JOIN auth.users u ON u.id = p.user_id WHERE p.role = 'admin';

-- ── Rollback ────────────────────────────────────────────────────────────────
-- Order matters: trigger, then functions, then tables (subscriptions before
-- plans, since it references them).
--
--   DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--   DROP FUNCTION IF EXISTS public.handle_new_user();
--   DROP FUNCTION IF EXISTS public.can_access_feature(text, uuid);
--   DROP FUNCTION IF EXISTS public.subscriptions_enabled();
--   DROP FUNCTION IF EXISTS public.is_admin(uuid);
--   DROP TABLE IF EXISTS public.feature_permissions;
--   DROP TABLE IF EXISTS public.user_subscriptions;
--   DROP TABLE IF EXISTS public.user_profiles;
--   DROP TABLE IF EXISTS public.subscription_plans;
--   DROP TABLE IF EXISTS public.platform_settings;
--
-- Nothing above is referenced by any intelligence table, so a rollback cannot
-- cascade into match, team or module data.

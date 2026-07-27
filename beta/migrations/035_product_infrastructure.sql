-- ─── MIGRATION 035 — Product infrastructure ─────────────────────────────────
--
-- The data layer for Phases 3.1 through 3.6 in one migration, because these
-- tables reference each other and applying them piecemeal leaves the schema in
-- states where half the foreign keys dangle.
--
--   3.1  user_favourite_leagues
--   3.2  watchlists
--   3.3  notification_preferences, notifications
--   3.5  subscription_events, plus the wider status set
--   3.6  customers, and the Stripe columns on user_subscriptions
--
-- No payment provider is integrated. Nothing here charges anything, and the
-- subscription flag stays off.
--
-- Touches no intelligence table. Match, team and module calculations are
-- unaffected by every statement below.
--
-- A NOTE ON FOREIGN KEYS
-- The brief specifies user_profiles as the parent for favourites. These all
-- reference auth.users(id) instead, because auth.uid() is what every RLS policy
-- compares against — routing through user_profiles.id would mean each policy
-- needs a join to answer "is this yours". ON DELETE CASCADE from auth.users
-- also means deleting an account takes its data with it, which
-- user_profiles.id would not guarantee on its own.

-- ── 3.1 Favourite leagues ───────────────────────────────────────────────────
-- "Leagues" are tournaments in this schema; there is no separate table.
CREATE TABLE IF NOT EXISTS public.user_favourite_leagues (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tournament_id bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_favourite_leagues_pkey PRIMARY KEY (id),
  -- Favouriting twice is a no-op, not a second row.
  CONSTRAINT user_favourite_leagues_unique UNIQUE (user_id, tournament_id)
);
CREATE INDEX IF NOT EXISTS idx_fav_leagues_user ON public.user_favourite_leagues(user_id);

-- ── 3.2 Watchlist ───────────────────────────────────────────────────────────
-- entity_id is a bigint referencing whichever table entity_type names, so a
-- database-level foreign key is not possible across three parents. The CHECK
-- constrains the type; referential integrity is enforced by the delete triggers
-- below rather than left to hope.
CREATE TABLE IF NOT EXISTS public.watchlists (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('match', 'team', 'league')),
  entity_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT watchlists_pkey PRIMARY KEY (id),
  CONSTRAINT watchlists_unique UNIQUE (user_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_watchlists_user ON public.watchlists(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_entity ON public.watchlists(entity_type, entity_id);

-- Polymorphic rows outlive their targets unless something clears them.
CREATE OR REPLACE FUNCTION public.prune_watchlist_entity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.watchlists
   WHERE entity_type = TG_ARGV[0] AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prune_watchlist_match ON public.matches;
CREATE TRIGGER prune_watchlist_match AFTER DELETE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.prune_watchlist_entity('match');
DROP TRIGGER IF EXISTS prune_watchlist_team ON public.teams;
CREATE TRIGGER prune_watchlist_team AFTER DELETE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.prune_watchlist_entity('team');
DROP TRIGGER IF EXISTS prune_watchlist_league ON public.tournaments;
CREATE TRIGGER prune_watchlist_league AFTER DELETE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.prune_watchlist_entity('league');

-- ── 3.3 Notifications ───────────────────────────────────────────────────────
-- Data layer only. Nothing sends anything.
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Delivery channels default OFF. A preference row created before any consent
  -- was given must not read as consent.
  email_notifications boolean NOT NULL DEFAULT false,
  push_notifications boolean NOT NULL DEFAULT false,
  -- Topics default ON: they only decide what a notification would say once a
  -- channel is enabled, so they cost nothing while every channel is off.
  friday_briefing boolean NOT NULL DEFAULT true,
  consensus_changes boolean NOT NULL DEFAULT true,
  module_changes boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  entity_type text CHECK (entity_type IS NULL OR entity_type IN ('match', 'team', 'league')),
  entity_id bigint,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
-- Partial index: the unread count is the only query that runs on every page.
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- ── 3.5 Subscription lifecycle ──────────────────────────────────────────────
ALTER TABLE public.user_subscriptions
  DROP CONSTRAINT IF EXISTS user_subscriptions_status_check;
ALTER TABLE public.user_subscriptions
  ADD CONSTRAINT user_subscriptions_status_check
  CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired'));

-- The partial unique index from 033 covered status = 'active' only. A trialing
-- subscription is equally live, so it belongs under the same constraint.
DROP INDEX IF EXISTS idx_user_subs_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subs_one_live
  ON public.user_subscriptions(user_id) WHERE status IN ('trialing', 'active');

-- An append-only audit trail. Every plan change should be explicable after the
-- fact, which a status column alone cannot do — it holds only the latest value.
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'upgraded', 'downgraded', 'renewed',
    'cancelled', 'expired', 'payment_failed', 'reactivated'
  )),
  old_plan text,
  new_plan text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscription_events_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_sub_events_user
  ON public.subscription_events(user_id, created_at DESC);

-- ── 3.6 Stripe preparation ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customers (
  id bigint GENERATED ALWAYS AS IDENTITY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customers_pkey PRIMARY KEY (id)
);

ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subs_stripe
  ON public.user_subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN public.user_subscriptions.provider IS
  'manual | stripe. Rows with provider = stripe are owned by webhook handlers and must not be edited by hand: the next webhook would overwrite the change and the two systems would disagree about what the customer is paying for.';

-- ── Row level security ──────────────────────────────────────────────────────
ALTER TABLE public.user_favourite_leagues   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlists               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers                ENABLE ROW LEVEL SECURITY;

-- Personal data: own rows, full control. Admins can read for support.
DROP POLICY IF EXISTS fav_own ON public.user_favourite_leagues;
CREATE POLICY fav_own ON public.user_favourite_leagues FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS watch_own ON public.watchlists;
CREATE POLICY watch_own ON public.watchlists FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notif_prefs_own ON public.notification_preferences;
CREATE POLICY notif_prefs_own ON public.notification_preferences FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Notifications are written by the system, not the recipient. Read and mark
-- read only — nobody should be able to forge one addressed to themselves.
DROP POLICY IF EXISTS notif_read ON public.notifications;
CREATE POLICY notif_read ON public.notifications FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS notif_mark ON public.notifications;
CREATE POLICY notif_mark ON public.notifications FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS notif_admin ON public.notifications;
CREATE POLICY notif_admin ON public.notifications FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Billing history is readable, never writable by the subject: an audit trail
-- the audited party can edit is not an audit trail.
DROP POLICY IF EXISTS sub_events_read ON public.subscription_events;
CREATE POLICY sub_events_read ON public.subscription_events FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS sub_events_admin ON public.subscription_events;
CREATE POLICY sub_events_admin ON public.subscription_events FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS customers_read ON public.customers;
CREATE POLICY customers_read ON public.customers FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS customers_admin ON public.customers;
CREATE POLICY customers_admin ON public.customers FOR ALL
  USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.user_favourite_leagues, public.watchlists,
     public.notification_preferences TO authenticated;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT SELECT ON public.subscription_events, public.customers TO authenticated;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS prune_watchlist_match ON public.matches;
--   DROP TRIGGER IF EXISTS prune_watchlist_team ON public.teams;
--   DROP TRIGGER IF EXISTS prune_watchlist_league ON public.tournaments;
--   DROP FUNCTION IF EXISTS public.prune_watchlist_entity();
--   DROP TABLE IF EXISTS public.customers, public.subscription_events,
--     public.notifications, public.notification_preferences,
--     public.watchlists, public.user_favourite_leagues;
--   ALTER TABLE public.user_subscriptions
--     DROP COLUMN IF EXISTS provider,
--     DROP COLUMN IF EXISTS stripe_subscription_id,
--     DROP COLUMN IF EXISTS current_period_start,
--     DROP COLUMN IF EXISTS current_period_end,
--     DROP COLUMN IF EXISTS cancel_at_period_end;
--   -- then restore the 033 status CHECK and idx_user_subs_one_active.

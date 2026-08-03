-- =============================================================================
-- 011_product.sql — Layer 4: plans, entitlement, subscriptions, user data
-- Source: Doc 08 Rev 1 §B.8.5 stage 12, A.1  |  Depends: 001-010  |  Transactional
--
-- Layer rule: authoritative for exactly three things — what a user chose, what
-- a user is entitled to, and what the platform is configured to do. Authoritative
-- for nothing about football. No schema references product.
-- =============================================================================

CREATE TABLE product.plan (
  id            bigint      GENERATED ALWAYS AS IDENTITY,
  plan_key      text        NOT NULL,
  display_name  text        NOT NULL,
  rank          integer     NOT NULL,
  price_amount  numeric     NOT NULL,
  currency_code text        NOT NULL,
  billing_interval text     NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_plan               PRIMARY KEY (id),
  CONSTRAINT uq_plan__plan_key     UNIQUE (plan_key),
  CONSTRAINT uq_plan__rank         UNIQUE (rank),
  CONSTRAINT fk_plan__currency     FOREIGN KEY (currency_code)
    REFERENCES football.currency (code) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_plan__price_non_negative CHECK (price_amount >= 0),
  CONSTRAINT ck_plan__interval_known CHECK (billing_interval IN ('MONTH','YEAR','ONCE'))
);
COMMENT ON TABLE product.plan IS
  'E8.03. Plan definitions exist ONLY here (LC-146). The previous platform duplicated them into application code alongside prices and inclusion lists, so the platform held two answers to what a plan costs. Explicit rank makes tier comparison data-driven.';

CREATE TABLE product.entitlement_feature (
  feature_key   text        NOT NULL,
  display_name  text        NOT NULL,
  meaning       text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_entitlement_feature PRIMARY KEY (feature_key)
);
COMMENT ON TABLE product.entitlement_feature IS
  'E8.04. Entitlement keys exist ONLY here (LC-148). Previously duplicated as a fixed list in application code with a hand-maintained mapping, so a record added without a code change was invisible and a code change without a record silently granted access. A module DECLARES its requirement; entitlement does not enumerate modules (LC-149).';

CREATE TABLE product.plan_entitlement (
  id                      bigint      GENERATED ALWAYS AS IDENTITY,
  plan_id                 bigint      NOT NULL,
  entitlement_feature_key text        NOT NULL,
  granted_period          tstzrange   NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_plan_entitlement PRIMARY KEY (id),
  CONSTRAINT fk_plan_entitlement__plan FOREIGN KEY (plan_id)
    REFERENCES product.plan (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_plan_entitlement__feature FOREIGN KEY (entitlement_feature_key)
    REFERENCES product.entitlement_feature (feature_key) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_plan_entitlement__period_bounded CHECK (NOT isempty(granted_period)),
  CONSTRAINT ex_plan_entitlement__no_overlapping_grants
    EXCLUDE USING gist (plan_id WITH =, entitlement_feature_key WITH =, granted_period WITH &&)
);
COMMENT ON TABLE product.plan_entitlement IS
  'E8.05 Feature Matrix. A PLAN-BY-FEATURE MATRIX, not a single minimum plan per capability (LC-150). The previous shape could not express a capability available on two non-adjacent plans, one temporarily promoted, or one granted outside the rank ordering. Grants are effective-dated so historical resolution is possible (LC-151).';

CREATE TABLE product.subscription (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  user_id           uuid        NOT NULL,
  plan_id           bigint      NOT NULL,
  status            text        NOT NULL,
  subscription_period tstzrange NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_subscription PRIMARY KEY (id),
  CONSTRAINT fk_subscription__user FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_subscription__plan FOREIGN KEY (plan_id)
    REFERENCES product.plan (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_subscription__status_known
    CHECK (status IN ('TRIALING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED')),
  CONSTRAINT ck_subscription__period_bounded CHECK (NOT isempty(subscription_period))
);
COMMENT ON TABLE product.subscription IS
  'E8.06. Unpartitioned, so the live-subscription rule is expressible as a PARTIAL unique index (created in 013) — the prohibition of F-03 applies to partitioned relations only.';

-- LC-152: at most one live subscription per user.
CREATE UNIQUE INDEX ux_subscription__user__live
  ON product.subscription (user_id) WHERE status IN ('TRIALING','ACTIVE','PAST_DUE');

CREATE TABLE product.subscription_event (
  id              bigint      GENERATED ALWAYS AS IDENTITY,
  subscription_id bigint      NOT NULL,
  event_type      text        NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  from_plan_id    bigint,
  to_plan_id      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_subscription_event PRIMARY KEY (id),
  CONSTRAINT fk_subscription_event__subscription FOREIGN KEY (subscription_id)
    REFERENCES product.subscription (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_subscription_event__from_plan FOREIGN KEY (from_plan_id)
    REFERENCES product.plan (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_subscription_event__to_plan FOREIGN KEY (to_plan_id)
    REFERENCES product.plan (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE product.subscription_event IS 'E8.06. LC-153: transitions recorded as events.';

-- -----------------------------------------------------------------------------
-- watchlist  (A.1 — composite fixture reference)
-- -----------------------------------------------------------------------------

CREATE TABLE product.watchlist (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  user_id               uuid        NOT NULL,
  entity_kind           text        NOT NULL,
  team_id               bigint,
  fixture_id            bigint,
  fixture_partition_on  date,
  competition_id        bigint,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_watchlist PRIMARY KEY (id),
  CONSTRAINT uq_watchlist__user_entity
    UNIQUE (user_id, entity_kind, team_id, fixture_id, fixture_partition_on, competition_id),
  CONSTRAINT fk_watchlist__user FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_watchlist__team FOREIGN KEY (team_id)
    REFERENCES football.team (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- A.1: fixture is partitioned, so the reference is COMPOSITE.
  CONSTRAINT fk_watchlist__fixture FOREIGN KEY (fixture_id, fixture_partition_on)
    REFERENCES football.fixture (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_watchlist__competition FOREIGN KEY (competition_id)
    REFERENCES football.competition (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_watchlist__entity_exclusive CHECK (
    (entity_kind = 'TEAM'        AND team_id IS NOT NULL AND fixture_id IS NULL
       AND fixture_partition_on IS NULL AND competition_id IS NULL) OR
    (entity_kind = 'FIXTURE'     AND fixture_id IS NOT NULL AND fixture_partition_on IS NOT NULL
       AND team_id IS NULL AND competition_id IS NULL) OR
    (entity_kind = 'COMPETITION' AND competition_id IS NOT NULL AND team_id IS NULL
       AND fixture_id IS NULL AND fixture_partition_on IS NULL)
  )
);
COMMENT ON TABLE product.watchlist IS
  'E8.07. A.1: the fixture reference carries the partition date and is composite. The exclusivity check is EXTENDED to cover the partition date column, so a FIXTURE entry must carry both and a non-fixture entry neither.
   Typed references give real referential integrity, which is stronger than the polymorphic identifier the previous platform used and which required prune triggers to defend (LC-155). The watchlist referential-defence trigger of migration 015 remains for the DELETE case, since these references are RESTRICT rather than CASCADE.';

CREATE TABLE product.user_preference (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  user_id           uuid        NOT NULL,
  preference_domain text        NOT NULL,
  competition_id    bigint,
  preference_value  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_user_preference PRIMARY KEY (id),
  CONSTRAINT uq_user_preference__user_domain_competition
    UNIQUE (user_id, preference_domain, competition_id),
  CONSTRAINT fk_user_preference__user FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_user_preference__competition FOREIGN KEY (competition_id)
    REFERENCES football.competition (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE product.user_preference IS
  'E8.08. Authoritative user data — one of only three things this layer owns outright. Never derived (LC-156).';

CREATE TABLE product.notification_intent (
  id                              bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at                     timestamptz NOT NULL DEFAULT now(),
  user_id                         uuid        NOT NULL,
  notification_trigger_version_id bigint      NOT NULL,
  topic                           text        NOT NULL,
  triggering_kind                 text        NOT NULL,
  triggering_snapshot_id          bigint,
  triggering_fixture_partition_on date,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_notification_intent PRIMARY KEY (id, occurred_at),
  CONSTRAINT fk_notification_intent__user FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_notification_intent__trigger_version
    FOREIGN KEY (notification_trigger_version_id)
    REFERENCES product.notification_trigger_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_notification_intent__snapshot
    FOREIGN KEY (triggering_snapshot_id, triggering_fixture_partition_on)
    REFERENCES snapshot.match_snapshot (id, fixture_partition_on) ON DELETE RESTRICT ON UPDATE RESTRICT
) PARTITION BY RANGE (occurred_at);
COMMENT ON TABLE product.notification_intent IS
  'E8.09. A statement that something OCCURRED which a user asked to hear about — distinct from any act of delivery. Append-only. Notification is a product decision recorded as open in Phase 4; this relation is specified so the decision is unblocked, not pre-empted. Nothing depends on it and its absence changes nothing.';

DO $$
DECLARE d date; d_end date;
BEGIN
  d := date '2024-01-01';
  WHILE d < date '2029-01-01' LOOP
    d_end := (d + interval '1 month')::date;
    EXECUTE format('CREATE TABLE product.%I PARTITION OF product.notification_intent FOR VALUES FROM (%L) TO (%L)',
                   'notification_intent_p' || to_char(d, 'YYYYMM'), d, d_end);
    EXECUTE format('ALTER TABLE product.%I OWNER TO pt_owner', 'notification_intent_p' || to_char(d, 'YYYYMM'));
    d := d_end;
  END LOOP;
END
$$;
CREATE TABLE product.notification_intent_pdefault PARTITION OF product.notification_intent DEFAULT;

-- -----------------------------------------------------------------------------
-- Read model registry and projection refresh state
-- -----------------------------------------------------------------------------

CREATE TABLE product.read_model (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  read_model_key        text        NOT NULL,
  display_name          text        NOT NULL,
  strategy              text        NOT NULL,
  freshness_tolerance   interval    NOT NULL,
  holds_scoped_content  boolean     NOT NULL DEFAULT false,
  rebuild_definition    text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_read_model            PRIMARY KEY (id),
  CONSTRAINT uq_read_model__key       UNIQUE (read_model_key),
  CONSTRAINT ck_read_model__strategy_known
    CHECK (strategy IN ('VIEW','MATERIALISED_VIEW','PROJECTION_RELATION','DIRECT')),
  -- F-05: entitlement-scoped content is NEVER held in a materialised view,
  -- because row-level security does not apply to materialised views.
  CONSTRAINT ck_read_model__scoped_content_not_materialised
    CHECK (NOT holds_scoped_content OR strategy <> 'MATERIALISED_VIEW')
);
COMMENT ON TABLE product.read_model IS
  'E8.01. An UNREGISTERED READ PATH IS OUTSIDE THIS DESIGN. This prevents recurrence of the condition found in the previous platform, where objects on primary read paths existed without definition in any controlled artefact.';
COMMENT ON CONSTRAINT ck_read_model__scoped_content_not_materialised ON product.read_model IS
  'F-05 enforced declaratively. Where entitlement scoping is required over materialised content, the content is held in a PROJECTION RELATION, which supports policies.';

CREATE TABLE product.read_model_source (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  read_model_id         bigint      NOT NULL,
  source_schema_name    text        NOT NULL,
  source_relation_name  text        NOT NULL,
  drawn_context_kind    text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_read_model_source PRIMARY KEY (id),
  CONSTRAINT uq_read_model_source__model_relation
    UNIQUE (read_model_id, source_schema_name, source_relation_name),
  CONSTRAINT fk_read_model_source__read_model FOREIGN KEY (read_model_id)
    REFERENCES product.read_model (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_read_model_source__context_kind FOREIGN KEY (drawn_context_kind)
    REFERENCES football.context_kind (code) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE product.read_model_source IS 'LC-143: declares the context at which each quantity is drawn.';

CREATE TABLE product.projection_refresh_state (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  read_model_id         bigint      NOT NULL,
  scope_key             text        NOT NULL,
  last_refreshed_at     timestamptz,
  source_watermark      timestamptz,
  read_model_version_id bigint,
  last_outcome          text,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_projection_refresh_state PRIMARY KEY (id),
  CONSTRAINT uq_projection_refresh_state__model_scope UNIQUE (read_model_id, scope_key),
  CONSTRAINT fk_projection_refresh_state__read_model FOREIGN KEY (read_model_id)
    REFERENCES product.read_model (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_projection_refresh_state__version FOREIGN KEY (read_model_version_id)
    REFERENCES product.read_model_version (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
COMMENT ON TABLE product.projection_refresh_state IS
  'E8.02. Records last refresh, source watermark and the read model version applied. This is what permits staleness to be REPORTED against a projection rather than inferred (§B.13.5, F-05 companion).';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plan','entitlement_feature','plan_entitlement','subscription',
    'subscription_event','watchlist','user_preference','notification_intent',
    'read_model','read_model_source','projection_refresh_state'] LOOP
    EXECUTE format('ALTER TABLE product.%I OWNER TO pt_owner', t);
  END LOOP;
END
$$;

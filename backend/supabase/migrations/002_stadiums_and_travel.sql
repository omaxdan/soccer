-- =============================================================================
-- RIP Migration 002: Stadiums & Travel Intelligence
-- Supports: stadium coordinates, travel distances, travel fatigue scoring
-- Future: weather integration, timezone calculations, travel-fatigue scoring
-- =============================================================================

-- 1. Stadiums table
CREATE TABLE IF NOT EXISTS stadiums (
    id BIGSERIAL PRIMARY KEY,
    external_id BIGINT UNIQUE,
    name TEXT NOT NULL,
    city TEXT,
    state_region TEXT,
    country TEXT NOT NULL,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    elevation_meters INTEGER,
    timezone TEXT,
    capacity INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stadiums_external_id ON stadiums(external_id);
CREATE INDEX IF NOT EXISTS idx_stadiums_country ON stadiums(country);

-- 2. Link teams to their home stadium
ALTER TABLE teams ADD COLUMN IF NOT EXISTS stadium_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_team_stadium'
    ) THEN
        ALTER TABLE teams
            ADD CONSTRAINT fk_team_stadium
            FOREIGN KEY (stadium_id) REFERENCES stadiums(id) ON DELETE SET NULL;
    END IF;
END$$;

-- 3. Link matches to their actual venue (cup finals, neutral grounds, etc.)
ALTER TABLE matches ADD COLUMN IF NOT EXISTS venue_id BIGINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_match_venue'
    ) THEN
        ALTER TABLE matches
            ADD CONSTRAINT fk_match_venue
            FOREIGN KEY (venue_id) REFERENCES stadiums(id) ON DELETE SET NULL;
    END IF;
END$$;

-- 4. Team home location cache (fast coordinate lookups, avoids repeated joins)
CREATE TABLE IF NOT EXISTS team_locations (
    team_id BIGINT PRIMARY KEY,
    stadium_id BIGINT,
    city TEXT,
    country TEXT,
    latitude NUMERIC(10,7),
    longitude NUMERIC(10,7),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_team_locations_team
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    CONSTRAINT fk_team_locations_stadium
        FOREIGN KEY (stadium_id) REFERENCES stadiums(id) ON DELETE SET NULL
);

-- 5. Team travel load - precomputed, never calculated at request time
CREATE TABLE IF NOT EXISTS team_travel_load (
    id BIGSERIAL PRIMARY KEY,
    team_id BIGINT NOT NULL,
    snapshot_date DATE NOT NULL,
    km_last_7_days NUMERIC(12,2) DEFAULT 0,
    km_last_14_days NUMERIC(12,2) DEFAULT 0,
    km_last_30_days NUMERIC(12,2) DEFAULT 0,
    away_matches_last_7_days INTEGER DEFAULT 0,
    away_matches_last_14_days INTEGER DEFAULT 0,
    away_matches_last_30_days INTEGER DEFAULT 0,
    avg_trip_distance_km NUMERIC(12,2),
    travel_fatigue_score NUMERIC(5,2),
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, snapshot_date),
    CONSTRAINT fk_travel_team
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_team_travel_team ON team_travel_load(team_id);
CREATE INDEX IF NOT EXISTS idx_team_travel_snapshot ON team_travel_load(snapshot_date);

-- 6. Match travel intelligence - per-match travel burden, precomputed
CREATE TABLE IF NOT EXISTS match_travel_intelligence (
    id BIGSERIAL PRIMARY KEY,
    match_id BIGINT NOT NULL UNIQUE,
    home_team_distance_km NUMERIC(12,2),
    away_team_distance_km NUMERIC(12,2),
    travel_advantage_km NUMERIC(12,2),
    travel_advantage_team_id BIGINT,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT fk_match_travel_match
        FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_match_travel_match ON match_travel_intelligence(match_id);

-- 7. Add travel columns to existing intelligence tables
ALTER TABLE team_intelligence
    ADD COLUMN IF NOT EXISTS travel_fatigue_score NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS travel_load_km NUMERIC(12,2);

ALTER TABLE match_intelligence
    ADD COLUMN IF NOT EXISTS home_travel_distance_km NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS away_travel_distance_km NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS travel_advantage_score NUMERIC(5,2);

-- =============================================================================
-- ARCHITECTURE NOTE:
-- ❌ Never calculate travel distances at request time
-- ✅ Calculate in cron jobs: computeTravelDistances(), computeTravelFatigue()
-- ✅ Save results to team_travel_load and match_travel_intelligence
-- ✅ Frontend reads only from these precomputed tables
--
-- Future cron jobs to add (Phase 2+):
--   syncStadiums()               - daily
--   computeTravelDistances()     - hourly
--   computeTravelFatigue()       - hourly
--   updateMatchTravelIntelligence() - hourly
-- =============================================================================

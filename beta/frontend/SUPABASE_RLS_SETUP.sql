-- Run this ONCE in Supabase SQL Editor
-- Required for the frontend to read data
-- Go to: Supabase Dashboard → SQL Editor → New Query → Paste → Run

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'countries', 'tournaments', 'seasons',
    'teams', 'players',
    'matches', 'match_results',
    'match_intelligence', 'match_travel_intelligence',
    'team_intelligence', 'team_form_history',
    'team_fixture_load', 'team_travel_load', 'team_locations',
    'stadiums', 'team_squads_snapshot',
    'team_strength_ratings', 'team_venue_performance',
    'team_position_depth', 'team_transfer_intelligence',
    'player_injuries', 'player_transfers'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    BEGIN
      EXECUTE format(
        'CREATE POLICY "public_read_%s" ON %I FOR SELECT USING (true)',
        tbl, tbl
      );
    EXCEPTION WHEN duplicate_object THEN
      NULL; -- Policy already exists, skip
    END;
  END LOOP;
END;
$$;

-- Verify: should show policy for every table
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename;

import { db } from '../db/client';
import { logger } from '../utils/logger';

// ─── TEAM TRANSFER INTELLIGENCE ───────────────────────────────────────────────

export interface TeamTransferIntelligence {
  team_id: number;
  transfers_in: number;
  transfers_out: number;
  retained_players: number;
  retention_percentage: number | null;
  transfer_activity_score: number | null;
}

class TeamTransferIntelligenceRepository {
  async upsert(data: TeamTransferIntelligence): Promise<void> {
    const payload = { ...data, calculated_at: new Date().toISOString() };
    const { error } = await db
      .from('team_transfer_intelligence')
      .upsert(payload, { onConflict: 'team_id' });
    if (error) logger.error({ error: error.message, teamId: data.team_id }, 'TeamTransferIntelligence upsert failed');
  }

  async getForTeam(teamId: number): Promise<TeamTransferIntelligence | null> {
    const { data } = await db
      .from('team_transfer_intelligence')
      .select('*')
      .eq('team_id', teamId)
      .single();
    return data ?? null;
  }
}

export const teamTransferIntelligenceRepository = new TeamTransferIntelligenceRepository();

// ─── TEAM STRENGTH RATINGS ────────────────────────────────────────────────────

export interface TeamStrengthRating {
  team_id: number;
  league_position?: number | null;
  points_per_game?: number | null;
  win_percentage?: number | null;
  strength_score?: number | null;
  market_value_eur?: number | null;
}

class TeamStrengthRatingsRepository {
  async upsert(data: TeamStrengthRating): Promise<void> {
    const payload = { ...data, calculated_at: new Date().toISOString() };
    const { error } = await db
      .from('team_strength_ratings')
      .upsert(payload, { onConflict: 'team_id' });
    if (error) logger.error({ error: error.message, teamId: data.team_id }, 'TeamStrengthRatings upsert failed');
  }

  async upsertBatch(rows: TeamStrengthRating[]): Promise<void> {
    if (rows.length === 0) return;
    const payloads = rows.map(r => ({ ...r, calculated_at: new Date().toISOString() }));
    const chunkSize = 200;
    for (let i = 0; i < payloads.length; i += chunkSize) {
      const { error } = await db
        .from('team_strength_ratings')
        .upsert(payloads.slice(i, i + chunkSize), { onConflict: 'team_id' });
      if (error) logger.error({ error: error.message }, 'TeamStrengthRatings batch upsert failed');
    }
  }
}

export const teamStrengthRatingsRepository = new TeamStrengthRatingsRepository();

// ─── TEAM VENUE PERFORMANCE ───────────────────────────────────────────────────

export interface TeamVenuePerformance {
  team_id: number;
  home_matches: number;
  away_matches: number;
  home_points_per_game: number | null;
  away_points_per_game: number | null;
  home_win_pct: number | null;
  away_win_pct: number | null;
  home_goal_diff: number | null;
  away_goal_diff: number | null;
  venue_advantage_score: number | null;
}

class TeamVenuePerformanceRepository {
  async upsert(data: TeamVenuePerformance): Promise<void> {
    const payload = { ...data, calculated_at: new Date().toISOString() };
    const { error } = await db
      .from('team_venue_performance')
      .upsert(payload, { onConflict: 'team_id' });
    if (error) logger.error({ error: error.message, teamId: data.team_id }, 'TeamVenuePerformance upsert failed');
  }

  async upsertBatch(rows: TeamVenuePerformance[]): Promise<void> {
    if (rows.length === 0) return;
    const payloads = rows.map(r => ({ ...r, calculated_at: new Date().toISOString() }));
    const chunkSize = 200;
    for (let i = 0; i < payloads.length; i += chunkSize) {
      const { error } = await db
        .from('team_venue_performance')
        .upsert(payloads.slice(i, i + chunkSize), { onConflict: 'team_id' });
      if (error) logger.error({ error: error.message }, 'TeamVenuePerformance batch upsert failed');
    }
  }
}

export const teamVenuePerformanceRepository = new TeamVenuePerformanceRepository();

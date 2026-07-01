import { db } from '../db/client';
import { logger } from '../utils/logger';

export interface PlayerInjury {
  player_id: number;
  injury_reason?: string | null;
  injury_status?: string | null;
  expected_return_days?: number | null;
  start_timestamp?: number | null;
  end_timestamp?: number | null;
  updated_timestamp?: number | null;
  active?: boolean;
  days_out?: number | null;
  injury_severity_score?: number | null;
  position_at_injury?: string | null;
  market_value_at_injury?: number | null;
}

class PlayerInjuriesRepository {
  /**
   * Upsert injury record. Deduplication key: player_id + start_timestamp.
   * If start_timestamp is null, uses player_id only (one active record per player).
   */
  async upsert(injury: PlayerInjury): Promise<void> {
    // Build conflict key — prefer start_timestamp for dedup when available
    const payload = {
      ...injury,
      created_at: new Date().toISOString(),
    };

    // Try to find existing active record for this player + start_timestamp
    const matchQuery = db
      .from('player_injuries')
      .select('id')
      .eq('player_id', injury.player_id);

    if (injury.start_timestamp) {
      matchQuery.eq('start_timestamp', injury.start_timestamp);
    } else {
      matchQuery.eq('active', true);
    }

    const { data: existing } = await matchQuery.limit(1);

    if (existing && existing.length > 0) {
      // Update existing
      const { error } = await db
        .from('player_injuries')
        .update({ ...payload, created_at: undefined })
        .eq('id', existing[0].id);
      if (error) logger.error({ error: error.message, playerId: injury.player_id }, 'Failed to update player injury');
    } else {
      // Insert new
      const { error } = await db.from('player_injuries').insert(payload);
      if (error) logger.error({ error: error.message, playerId: injury.player_id }, 'Failed to insert player injury');
    }
  }

  /**
   * Mark all active injuries for a player as inactive.
   * Called when no injury is found in the latest squad response.
   */
  async markInactive(playerId: number): Promise<void> {
    const { error } = await db
      .from('player_injuries')
      .update({ active: false })
      .eq('player_id', playerId)
      .eq('active', true);

    if (error) {
      logger.debug({ error: error.message, playerId }, 'Failed to mark injuries inactive (may not exist)');
    }
  }

  /** Count active injuries for a team (via players table join) */
  async countActiveForTeam(teamId: number): Promise<number> {
    const { data } = await db
      .from('player_injuries')
      .select('id, player:players!fk_player_injuries_player(team_id)')
      .eq('active', true)
      .eq('player.team_id', teamId);
    return data?.length ?? 0;
  }
}

export const playerInjuriesRepository = new PlayerInjuriesRepository();

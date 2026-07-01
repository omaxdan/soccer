import { db } from '../db/client';
import { logger } from '../utils/logger';

export interface TeamPositionDepth {
  team_id: number;
  position_code: string;
  player_count: number;
  injured_count: number;
  available_count: number;
  total_market_value: number;
}

class TeamPositionDepthRepository {
  async upsert(data: TeamPositionDepth): Promise<void> {
    const { id: _id, ...payload } = { id: 0, ...data, updated_at: new Date().toISOString() };
    const { error } = await db
      .from('team_position_depth')
      .upsert(payload, { onConflict: 'team_id,position_code' });
    if (error) {
      logger.error({ error: error.message, teamId: data.team_id, position: data.position_code }, 'TeamPositionDepth upsert failed');
    }
  }

  async upsertBatch(rows: TeamPositionDepth[]): Promise<void> {
    if (rows.length === 0) return;
    const payloads = rows.map(({ ...r }) => ({ ...r, updated_at: new Date().toISOString() }));
    const { error } = await db
      .from('team_position_depth')
      .upsert(payloads, { onConflict: 'team_id,position_code' });
    if (error) {
      logger.error({ error: error.message, count: rows.length }, 'TeamPositionDepth batch upsert failed');
    }
  }

  async getForTeam(teamId: number): Promise<TeamPositionDepth[]> {
    const { data } = await db
      .from('team_position_depth')
      .select('*')
      .eq('team_id', teamId);
    return (data ?? []) as TeamPositionDepth[];
  }

  /** Weighted average of available_count across all positions for a team */
  async computePositionalDepthScore(teamId: number): Promise<number | null> {
    const rows = await this.getForTeam(teamId);
    if (rows.length === 0) return null;

    // Weights: GK (important), defence, midfield, attack
    const weights: Record<string, number> = {
      GK: 3, G: 3,
      DC: 2, DL: 2, DR: 2, D: 2,
      DM: 1.5, MC: 1, ML: 1, MR: 1, M: 1,
      AMC: 1, AML: 1, AMR: 1,
      LW: 1, RW: 1, ST: 2, F: 2,
    };

    let totalWeight = 0;
    let weightedSum = 0;

    for (const row of rows) {
      const w = weights[row.position_code] ?? 1;
      // Availability score: available_count / expected_count (typical: GK=3, others=4+)
      const expected = ['GK', 'G'].includes(row.position_code) ? 3 : 4;
      const avail = Math.min(1, row.available_count / expected);
      weightedSum += avail * w;
      totalWeight += w;
    }

    return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : null;
  }
}

export const teamPositionDepthRepository = new TeamPositionDepthRepository();

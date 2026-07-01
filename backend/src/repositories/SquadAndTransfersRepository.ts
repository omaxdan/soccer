import { db } from '../db/client';
import { TeamSquadSnapshot, PlayerTransfer } from '../types/index';
import { logger } from '../utils/logger';

export class TeamSquadSnapshotRepository {
  async findLatestForTeam(teamId: number): Promise<TeamSquadSnapshot | null> {
    const { data, error } = await db
      .from('team_squads_snapshot')
      .select('*')
      .eq('team_id', teamId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, teamId },
        'Failed to find squad snapshot'
      );
      throw error;
    }

    return data || null;
  }

  async findByTeamAndDate(
    teamId: number,
    date: string
  ): Promise<TeamSquadSnapshot | null> {
    const { data, error } = await db
      .from('team_squads_snapshot')
      .select('*')
      .eq('team_id', teamId)
      .eq('snapshot_date', date)
      .single();

    if (error && error.code !== 'PGRST116') {
      logger.error(
        { error: error.message, teamId, date },
        'Failed to find squad snapshot'
      );
      throw error;
    }

    return data || null;
  }

  async upsert(data: TeamSquadSnapshot): Promise<TeamSquadSnapshot> {
    const { id: _id, ...payload } = data as any; // strip id
    const { data: result, error } = await db
      .from('team_squads_snapshot')
      .upsert(payload, { onConflict: 'team_id,snapshot_date' })
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, teamId: data.team_id },
        'Failed to upsert squad snapshot'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(snapshots: TeamSquadSnapshot[]): Promise<number> {
    if (snapshots.length === 0) return 0;

    const { error } = await db
      .from('team_squads_snapshot')
      .upsert(snapshots as any, { onConflict: 'team_id,snapshot_date' });

    if (error) {
      logger.error(
        { error: error.message, count: snapshots.length },
        'Failed to batch upsert squad snapshots'
      );
      throw error;
    }

    return snapshots.length;
  }

  async getTeamHistory(
    teamId: number,
    limit: number = 10
  ): Promise<TeamSquadSnapshot[]> {
    const { data, error } = await db
      .from('team_squads_snapshot')
      .select('*')
      .eq('team_id', teamId)
      .order('snapshot_date', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, teamId },
        'Failed to get squad history'
      );
      throw error;
    }

    return data || [];
  }
}

export class PlayerTransfersRepository {
  async findByPlayerId(playerId: number): Promise<PlayerTransfer[]> {
    const { data, error } = await db
      .from('player_transfers')
      .select('*')
      .eq('player_id', playerId)
      .order('transfer_date', { ascending: false });

    if (error) {
      logger.error(
        { error: error.message, playerId },
        'Failed to find player transfers'
      );
      throw error;
    }

    return data || [];
  }

  async findRecentTransfers(
    days: number = 30,
    limit: number = 100
  ): Promise<PlayerTransfer[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const { data, error } = await db
      .from('player_transfers')
      .select('*')
      .gte('transfer_date', cutoffDate.toISOString().split('T')[0])
      .order('transfer_date', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, days },
        'Failed to get recent transfers'
      );
      throw error;
    }

    return data || [];
  }

  async upsert(data: PlayerTransfer): Promise<PlayerTransfer> {
    const { data: result, error } = await db
      .from('player_transfers')
      .upsert(data)
      .select()
      .single();

    if (error) {
      logger.error(
        { error: error.message, playerId: data.player_id },
        'Failed to upsert player transfer'
      );
      throw error;
    }

    return result;
  }

  async upsertBatch(transfers: PlayerTransfer[]): Promise<number> {
    if (transfers.length === 0) return 0;

    const { error } = await db.from('player_transfers').upsert(transfers as any);

    if (error) {
      logger.error(
        { error: error.message, count: transfers.length },
        'Failed to batch upsert transfers'
      );
      throw error;
    }

    return transfers.length;
  }

  async getTeamIncomingTransfers(
    teamId: number,
    limit: number = 50
  ): Promise<PlayerTransfer[]> {
    const { data, error } = await db
      .from('player_transfers')
      .select('*')
      .eq('to_team_id', teamId)
      .order('transfer_date', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, teamId },
        'Failed to get incoming transfers'
      );
      throw error;
    }

    return data || [];
  }

  async getTeamOutgoingTransfers(
    teamId: number,
    limit: number = 50
  ): Promise<PlayerTransfer[]> {
    const { data, error } = await db
      .from('player_transfers')
      .select('*')
      .eq('from_team_id', teamId)
      .order('transfer_date', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error(
        { error: error.message, teamId },
        'Failed to get outgoing transfers'
      );
      throw error;
    }

    return data || [];
  }
}

export const teamSquadSnapshotRepository = new TeamSquadSnapshotRepository();
export const playerTransfersRepository = new PlayerTransfersRepository();

// components/PredictedLineup.tsx

'use client';

import { COLORS } from '@/design/tokens';
import { deriveFormation } from '@/lib/insights';

// ─── Interface ──────────────────────────────────────────────────────────────
interface LineupPlayer {
  player_id: number;
  team_id: number;
  position_code: string;
  rank_in_position: number;
  matches_started: number;
  confidence: number;
  calculated_at: string;
  players: {
    id: number;
    name: string;
    position: string;
    position_detailed: string | null;
    primary_position: string | null;
    secondary_position: string | null;
    tertiary_position: string | null;
    jersey_number: number;
    current_injury: boolean;
  };
}

interface PredictedLineupProps {
  homeTeam: {
    id: number;
    name: string;
    short_name: string;
    crest_storage_path?: string;
  };
  awayTeam: {
    id: number;
    name: string;
    short_name: string;
    crest_storage_path?: string;
  };
  lineups: {
    home: LineupPlayer[];
    away: LineupPlayer[];
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Get position label - use position_detailed first, then fallback
function getPositionLabel(player: LineupPlayer): string {
  const detailed = player.players?.position_detailed;
  const primary = player.players?.primary_position;
  
  // Use position_detailed if available (e.g., "DC", "MC", "ST")
  if (detailed) return detailed;
  if (primary) return primary;
  return player.players?.position || '?';
}

// Get versatility: show primary + secondary positions
function getVersatility(player: LineupPlayer): string | null {
  const primary = player.players?.primary_position;
  const secondary = player.players?.secondary_position;
  const tertiary = player.players?.tertiary_position;
  
  const positions = [primary, secondary, tertiary].filter(Boolean);
  if (positions.length > 1) {
    return `🔄 ${positions.join('/')}`;
  }
  return null;
}

// Get color based on position group
function getPositionColor(positionCode: string): string {
  const map: Record<string, string> = {
    'G': COLORS.green,
    'GK': COLORS.green,
    'D': COLORS.blue,
    'DEF': COLORS.blue,
    'M': COLORS.amber,
    'MID': COLORS.amber,
    'F': COLORS.red,
    'FWD': COLORS.red,
  };
  return map[positionCode] || COLORS.muted;
}

// Normalize position code (G→GK, D→DEF, M→MID, F→FWD)
function normalizePositionCode(code: string): string {
  const map: Record<string, string> = {
    'G': 'GK',
    'D': 'DEF',
    'M': 'MID',
    'F': 'FWD',
  };
  return map[code] || code;
}

// Get color based on confidence
function getConfidenceColor(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (pct >= 80) return COLORS.green;
  if (pct >= 60) return COLORS.amber;
  return COLORS.red;
}

// Format confidence
function formatConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100);
  return `${pct}%`;
}

// ─── PlayerBadge Component ──────────────────────────────────────────────────
function PlayerBadge({ player }: { player: LineupPlayer }) {
  if (!player) return null;
  
  const playerData = player.players;
  const confidencePercent = Math.round((player.confidence || 0) * 100);
  const isInjured = playerData?.current_injury || false;
  const playerName = playerData?.name || '?';
  const jerseyNumber = playerData?.jersey_number || '—';
  const positionLabel = getPositionLabel(player);
  const versatility = getVersatility(player);
  const positionColor = getPositionColor(player.position_code);
  
  return (
    <div style={{
      textAlign: 'center',
      padding: '4px 2px',
      borderRadius: 6,
      background: isInjured ? COLORS.red + '15' : COLORS.surface2,
      border: isInjured ? `1px solid ${COLORS.red}` : `1px solid ${COLORS.border}`,
      position: 'relative',
    }}>
      {isInjured && (
        <div style={{
          position: 'absolute',
          top: -4,
          right: -4,
          background: COLORS.red,
          color: 'white',
          fontSize: 7,
          fontWeight: 700,
          borderRadius: '50%',
          width: 14,
          height: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>!</div>
      )}
      <div style={{
        fontSize: 8,
        fontWeight: 700,
        color: COLORS.text,
        marginBottom: 1,
      }}>
        {jerseyNumber}
      </div>
      <div style={{
        fontSize: 8,
        fontWeight: 600,
        color: COLORS.text,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: 65,
      }}>
        {playerName}
      </div>
      {/* ── Show detailed position ── */}
      <div style={{
        fontSize: 7,
        fontWeight: 700,
        color: positionColor,
        marginTop: 1,
        background: positionColor + '15',
        padding: '0 4px',
        borderRadius: 3,
        display: 'inline-block',
      }}>
        {positionLabel}
      </div>
      {/* ── Show versatility ── */}
      {versatility && (
        <div style={{
          fontSize: 6,
          color: COLORS.dim,
          marginTop: 1,
          maxWidth: 65,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {versatility}
        </div>
      )}
      <div style={{
        fontSize: 7,
        color: confidencePercent > 70 ? COLORS.green : confidencePercent > 40 ? COLORS.amber : COLORS.red,
        marginTop: 1,
        fontWeight: 700,
      }}>
        {confidencePercent}%
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function PredictedLineup({ homeTeam, awayTeam, lineups }: PredictedLineupProps) {
  if (!lineups.home.length && !lineups.away.length) {
    return (
      <div style={{
        padding: 30,
        textAlign: 'center',
        color: COLORS.muted,
        background: COLORS.surface2,
        borderRadius: 8,
        border: `1px dashed ${COLORS.border}`,
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.text }}>No predicted lineups available</div>
        <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 4 }}>
          Run process:predicted-lineups after squad sync
        </div>
      </div>
    );
  }

  const renderTeamLineup = (team: typeof homeTeam, players: LineupPlayer[]) => {
    // Normalize position codes
    const normalizedPlayers = players.map(p => ({
      ...p,
      position_code: normalizePositionCode(p.position_code),
    }));

    // Group by position
    const gk = normalizedPlayers.filter(p => p.position_code === 'GK');
    const def = normalizedPlayers.filter(p => p.position_code === 'DEF');
    const mid = normalizedPlayers.filter(p => p.position_code === 'MID');
    const fwd = normalizedPlayers.filter(p => p.position_code === 'FWD');

    // Real formation from each player's own detailed position (DC/DM/AM/
    // ST etc — the ORIGINAL, un-normalized position_code before the
    // GK/DEF/MID/FWD grouping above), not a hardcoded "4-4-2" regardless
    // of the actual predicted shape.
    const formation = deriveFormation(players.map(p => ({
      slotCode: p.position_code,
      detailedPosition: p.players?.primary_position ?? p.players?.position_detailed ?? null,
    })));

    // ─── Format player with confidence ──────────────────────────────────────
    const formatPlayerWithConfidence = (p: LineupPlayer) => {
      const name = p.players?.name || '?';
      const confidence = p.confidence || 0;
      const color = getConfidenceColor(confidence);
      
      return (
        <span key={p.player_id} style={{ display: 'inline-block' }}>
          <span style={{ color: COLORS.text }}>{name}</span>
          <span style={{ 
            fontWeight: 800, 
            fontSize: 13,
            color: color,
            marginLeft: 3,
            background: color + '15',
            padding: '0 4px',
            borderRadius: 3,
          }}>
            ({formatConfidence(confidence)})
          </span>
        </span>
      );
    };

    // ─── Format player with detailed position ──────────────────────────────
    const formatPlayerWithPosition = (p: LineupPlayer) => {
      const name = p.players?.name || '?';
      const positionLabel = getPositionLabel(p);
      const confidence = p.confidence || 0;
      const color = getConfidenceColor(confidence);
      
      return (
        <span key={p.player_id} style={{ display: 'inline-block' }}>
          <span style={{ color: COLORS.text }}>{name}</span>
          <span style={{ 
            fontSize: 9,
            color: COLORS.dim,
            marginLeft: 2,
            fontWeight: 600,
          }}>
            ({positionLabel})
          </span>
          <span style={{ 
            fontWeight: 800, 
            fontSize: 13,
            color: color,
            marginLeft: 3,
            background: color + '15',
            padding: '0 4px',
            borderRadius: 3,
          }}>
            {formatConfidence(confidence)}
          </span>
        </span>
      );
    };

    const avgConfidence = players.length > 0
      ? Math.round(players.reduce((sum, p) => sum + (p.confidence || 0), 0) / players.length * 100)
      : 0;

    const totalStarts = players.reduce((sum, p) => sum + (p.matches_started || 0), 0);

    // ─── Versatility stats ──────────────────────────────────────────────────
    const versatilePlayers = players.filter(p => {
      const primary = p.players?.primary_position;
      const secondary = p.players?.secondary_position;
      const tertiary = p.players?.tertiary_position;
      return [primary, secondary, tertiary].filter(Boolean).length > 1;
    });
    
    const versatilityPct = players.length > 0 
      ? Math.round((versatilePlayers.length / players.length) * 100) 
      : 0;

    const avgColor = getConfidenceColor(avgConfidence / 100);

    return (
      <div style={{
        background: COLORS.surface,
        borderRadius: 10,
        padding: 16,
        border: `1px solid ${COLORS.border}`,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          paddingBottom: 10,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {team?.crest_storage_path && (
              <img src={team.crest_storage_path} alt={team.name} style={{ width: 24, height: 24, objectFit: 'contain' }} />
            )}
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>
              {team?.short_name || team?.name || 'Team'}
            </div>
            {/* ── Versatility badge ── */}
            {versatilityPct > 20 && (
              <span style={{
                fontSize: 8,
                fontWeight: 700,
                color: COLORS.green,
                background: COLORS.green + '15',
                padding: '1px 6px',
                borderRadius: 4,
                border: `1px solid ${COLORS.green}30`,
              }}>
                🔄 {versatilityPct}% Versatile
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: COLORS.dim, textAlign: 'right' }}>
            <div>
              Avg Conf:{' '}
              <span style={{ 
                fontWeight: 800, 
                fontSize: 13, 
                color: avgColor,
                background: avgColor + '15',
                padding: '0 6px',
                borderRadius: 3,
              }}>
                {avgConfidence}%
              </span>
            </div>
            <div style={{ fontSize: 9 }}>{totalStarts} total starts</div>
          </div>
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.muted, marginBottom: 10 }}>
          Predicted Lineup{formation ? ` (${formation})` : ''}:
        </div>

        {/* GK */}
        {gk.length > 0 && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'baseline', 
            gap: 6, 
            padding: '4px 0',
            fontSize: 12,
            borderBottom: `1px solid ${COLORS.border}40`,
          }}>
            <span style={{ fontWeight: 700, color: COLORS.muted, minWidth: 38, fontSize: 12 }}>GK:</span>
            <span style={{ color: COLORS.text, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {gk.map(p => formatPlayerWithPosition(p))}
            </span>
          </div>
        )}

        {/* DEF */}
        {def.length > 0 && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'baseline', 
            gap: 6, 
            padding: '4px 0',
            fontSize: 12,
            borderBottom: `1px solid ${COLORS.border}40`,
          }}>
            <span style={{ fontWeight: 700, color: COLORS.muted, minWidth: 38, fontSize: 12 }}>DEF:</span>
            <span style={{ color: COLORS.text, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {def.map(p => formatPlayerWithPosition(p))}
            </span>
          </div>
        )}

        {/* MID */}
        {mid.length > 0 && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'baseline', 
            gap: 6, 
            padding: '4px 0',
            fontSize: 12,
            borderBottom: `1px solid ${COLORS.border}40`,
          }}>
            <span style={{ fontWeight: 700, color: COLORS.muted, minWidth: 38, fontSize: 12 }}>MID:</span>
            <span style={{ color: COLORS.text, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {mid.map(p => formatPlayerWithPosition(p))}
            </span>
          </div>
        )}

        {/* FWD */}
        {fwd.length > 0 && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'baseline', 
            gap: 6, 
            padding: '4px 0',
            fontSize: 12,
          }}>
            <span style={{ fontWeight: 700, color: COLORS.muted, minWidth: 38, fontSize: 12 }}>FWD:</span>
            <span style={{ color: COLORS.text, display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {fwd.map(p => formatPlayerWithPosition(p))}
            </span>
          </div>
        )}

        {/* Legend */}
        <div style={{ 
          marginTop: 10, 
          paddingTop: 8, 
          borderTop: `1px solid ${COLORS.border}`,
          display: 'flex',
          justifyContent: 'center',
          gap: 16,
          fontSize: 9, 
          color: COLORS.dim,
        }}>
          <span>🟢 High ≥80%</span>
          <span>🟡 Medium 60-79%</span>
          <span>🔴 Low &lt;60%</span>
        </div>

        <div style={{ 
          marginTop: 6,
          fontSize: 9, 
          color: COLORS.dim, 
          textAlign: 'center',
        }}>
          {players.length} players • {gk.length} GK • {def.length} DEF • {mid.length} MID • {fwd.length} FWD
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {renderTeamLineup(homeTeam, lineups.home)}
      {renderTeamLineup(awayTeam, lineups.away)}
    </div>
  );
}
import React from 'react';
import { COLORS } from '@/design/tokens';

interface PlayerRow {
  id: number;
  number: number;
  name: string;
  surname: string;
  position: string;
  positions: string[];
  confidence: number | null;
}

interface LineupsTableProps {
  players: PlayerRow[];
  positionGroups?: Record<string, PlayerRow[]>;
  teamName: string;
}

const POSITION_GROUPS = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_LABELS: Record<string, string> = {
  GK: 'Goalkeeper',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

function getPositionGroup(pos: string | string[]): string {
  const posStr = Array.isArray(pos) ? pos[0] : pos;
  if (posStr?.includes('GK')) return 'GK';
  if (posStr?.includes('D')) return 'DEF';
  if (posStr?.includes('M')) return 'MID';
  if (posStr?.includes('F')) return 'FWD';
  return 'MID';
}

function getConfidenceColor(conf: number | null): string {
  if (conf == null) return COLORS.dim;
  if (conf >= 85) return COLORS.green;
  if (conf >= 70) return COLORS.amber;
  if (conf >= 50) return COLORS.orange;
  return COLORS.red;
}

export default function LineupsTable({ players, teamName }: LineupsTableProps) {
  // Group players by position
  const grouped = POSITION_GROUPS.reduce((acc, group) => {
    acc[group] = players.filter(p => getPositionGroup(p.position || p.positions) === group);
    return acc;
  }, {} as Record<string, PlayerRow[]>);

  return (
    <div className="w-full space-y-6">
      {POSITION_GROUPS.map(group => {
        const groupPlayers = grouped[group];
        if (!groupPlayers || groupPlayers.length === 0) return null;

        return (
          <div key={group} className="space-y-2">
            {/* Position group header */}
            <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 px-2">
              {POSITION_LABELS[group]} ({groupPlayers.length})
            </h4>

            {/* Players grid */}
            <div className="space-y-0">
              {groupPlayers.map((player, idx) => (
                <div
                  key={player.id}
                  className={`grid grid-cols-[2.5rem_1fr_6rem_5rem] gap-3 items-center px-3 py-2.5 ${
                    idx !== groupPlayers.length - 1 ? 'border-b border-slate-800' : ''
                  }`}
                >
                  {/* Column 1: Jersey Number */}
                  <div className="flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center border border-slate-600">
                      <span className="text-xs font-bold text-slate-300">{player.number}</span>
                    </div>
                  </div>

                  {/* Column 2: Player Name */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-100 truncate leading-tight">
                      {player.surname || player.name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{player.name}</p>
                  </div>

                  {/* Column 3: Position Tag */}
                  <div className="flex items-center justify-center">
                    <span className="text-xs font-semibold text-slate-400 bg-slate-800 px-2 py-1 rounded whitespace-nowrap">
                      [{Array.isArray(player.positions) ? player.positions.join(',') : player.position}]
                    </span>
                  </div>

                  {/* Column 4: Confidence Badge (Fixed Right) */}
                  <div className="flex items-center justify-end">
                    {player.confidence != null ? (
                      <div
                        className="px-2.5 py-1 rounded-full text-xs font-bold text-white whitespace-nowrap"
                        style={{ backgroundColor: getConfidenceColor(player.confidence) + '30', color: getConfidenceColor(player.confidence) }}
                      >
                        {Math.round(player.confidence)}%
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {players.length === 0 && (
        <div className="px-4 py-8 text-center text-slate-500 text-sm">
          No lineup data available for {teamName}
        </div>
      )}
    </div>
  );
}

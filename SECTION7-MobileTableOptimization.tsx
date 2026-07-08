import React from 'react';
import { COLORS } from '@/design/tokens';

/**
 * SECTION 7: Mobile Table Responsiveness & Cell-Padding Reduction
 * 
 * STANDARDS:
 * - Relative REM padding compression (px-[0.25rem] to px-[0.375rem])
 * - Team/League column: min 40-45% width
 * - Short name enforcement
 * - Proportional grid alignment
 * - Touch-scrolling wrappers
 */

// ─── RESPONSIVE TABLE WRAPPER ───────────────────────────────────────────────

interface ResponsiveTableWrapperProps {
  children: React.ReactNode;
  className?: string;
}

export function ResponsiveTableWrapper({ children, className = '' }: ResponsiveTableWrapperProps) {
  return (
    <div className={`w-full overflow-x-auto touch-scroll-momentum ${className}`}>
      {children}
    </div>
  );
}

// ─── OPTIMIZED TABLE COMPONENT ──────────────────────────────────────────────

interface OptimizedTableProps {
  headers: { label: string; className?: string; sortable?: boolean; numeric?: boolean }[];
  rows: { cells: React.ReactNode[]; className?: string }[];
  minWidth?: string;
}

export function OptimizedTable({ headers, rows, minWidth = '100%' }: OptimizedTableProps) {
  return (
    <table className="w-full border-collapse text-xs" style={{ minWidth }}>
      <thead>
        <tr className="bg-slate-800 border-b border-slate-700">
          {headers.map((header, idx) => (
            <th
              key={idx}
              className={`px-[0.375rem] py-1.5 text-left font-bold uppercase tracking-wider text-slate-400 ${
                header.numeric ? 'text-right' : ''
              } ${header.className ?? ''}`}
            >
              {header.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIdx) => (
          <tr key={rowIdx} className={`border-b border-slate-700 hover:bg-slate-800 transition-colors ${row.className ?? ''}`}>
            {row.cells.map((cell, cellIdx) => (
              <td
                key={cellIdx}
                className={`px-[0.375rem] py-1 text-slate-200 ${
                  headers[cellIdx]?.numeric ? 'text-right font-mono' : ''
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── LEAGUE/TEAM CELL (40-45% width) ────────────────────────────────────────

interface TeamCellProps {
  logo?: string;
  name: string;
  shortName: string;
  subtext?: string;
}

export function TeamCell({ logo, name, shortName, subtext }: TeamCellProps) {
  return (
    <div className="flex items-center gap-2 min-w-0 w-[42%] max-w-[45%]">
      {logo && <img src={logo} alt={name} className="w-6 h-6 rounded flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-slate-100 truncate">{shortName}</p>
        {subtext && <p className="text-xs text-slate-500 truncate">{subtext}</p>}
      </div>
    </div>
  );
}

// ─── NUMERIC CELL (right-aligned, monospace) ───────────────────────────────

interface NumericCellProps {
  value: string | number;
  color?: string;
  highlight?: boolean;
}

export function NumericCell({ value, color, highlight }: NumericCellProps) {
  return (
    <span
      className={`font-mono font-bold whitespace-nowrap ${
        highlight ? 'text-slate-100' : color ?? 'text-slate-300'
      }`}
      style={{ color: color ? color : undefined }}
    >
      {value}
    </span>
  );
}

// ─── CONFIDENCE/STATUS BADGE ────────────────────────────────────────────────

interface BadgeProps {
  value: string | number;
  color?: 'green' | 'amber' | 'orange' | 'red' | 'blue' | 'gray';
  size?: 'sm' | 'md';
}

export function Badge({ value, color = 'gray', size = 'sm' }: BadgeProps) {
  const colorMap = {
    green: 'bg-emerald-500 text-white',
    amber: 'bg-amber-500 text-white',
    orange: 'bg-orange-500 text-white',
    red: 'bg-red-500 text-white',
    blue: 'bg-blue-500 text-white',
    gray: 'bg-slate-700 text-slate-300',
  };

  const sizeMap = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span className={`inline-block rounded-full font-bold whitespace-nowrap ${colorMap[color]} ${sizeMap[size]}`}>
      {value}
    </span>
  );
}

// ─── MATCH CENTER TABLE EXAMPLE ──────────────────────────────────────────────

interface MatchCenterTableProps {
  matches: any[];
}

export function MatchCenterTableOptimized({ matches }: MatchCenterTableProps) {
  const headers = [
    { label: '★', className: 'w-[1.5rem]' },
    { label: 'TIME', className: 'w-[2rem]' },
    { label: 'MATCH', className: 'w-[42%]' },
    { label: 'SCORE', className: 'w-[1.5rem]', numeric: true },
    { label: 'HOME', className: 'w-[11%]', numeric: true },
    { label: 'AWAY', className: 'w-[11%]', numeric: true },
    { label: 'GAP', className: 'w-[11%]', numeric: true },
    { label: 'PICK', className: 'w-[12%]', numeric: true },
    { label: 'CONF%', className: 'w-[12%]', numeric: true },
  ];

  const rows = matches.map(m => ({
    cells: [
      /* Star */ <span className="text-amber-400">★</span>,
      /* Time */ <span className="font-mono text-slate-400 text-xs">{m.time}</span>,
      /* Match */ (
        <TeamCell
          logo={m.homeTeam?.logo}
          name={m.homeTeam?.name}
          shortName={m.homeTeam?.short_name}
          subtext={m.awayTeam?.short_name}
        />
      ),
      /* Score */ <NumericCell value={m.score ?? '—'} />,
      /* Home */ <NumericCell value={m.homeReadiness ?? '—'} />,
      /* Away */ <NumericCell value={m.awayReadiness ?? '—'} />,
      /* Gap */ <NumericCell value={m.gap ?? '—'} />,
      /* Pick */ <span className="text-emerald-400 font-semibold text-xs">{m.pick ?? '—'}</span>,
      /* Conf */ (
        <Badge
          value={`${m.confidence ?? '—'}%`}
          color={
            m.confidence >= 80 ? 'green' : m.confidence >= 60 ? 'amber' : m.confidence >= 40 ? 'orange' : 'red'
          }
          size="sm"
        />
      ),
    ],
  }));

  return (
    <ResponsiveTableWrapper>
      <OptimizedTable headers={headers} rows={rows} minWidth="100%" />
    </ResponsiveTableWrapper>
  );
}

// ─── LEAGUE ANALYTICS TABLE EXAMPLE ──────────────────────────────────────────

interface LeagueAnalyticsTableProps {
  leagues: any[];
}

export function LeagueAnalyticsTableOptimized({ leagues }: LeagueAnalyticsTableProps) {
  const headers = [
    { label: 'League', className: 'w-[42%]' },
    { label: 'Picks', numeric: true, className: 'w-[11%]' },
    { label: 'Hit % (S)', numeric: true, className: 'w-[12%]' },
    { label: 'Hit % (L)', numeric: true, className: 'w-[12%]' },
    { label: 'Lift', numeric: true, className: 'w-[11%]' },
    { label: 'Status', className: 'w-[12%]' },
  ];

  const rows = leagues.map(league => ({
    cells: [
      /* League */ (
        <div className="truncate text-slate-100 font-semibold">
          {league.short_name || league.name}
        </div>
      ),
      /* Picks */ <NumericCell value={league.total_picks} />,
      /* Hit % (S) */ <NumericCell value={league.hit_rate_strict ? `${league.hit_rate_strict.toFixed(1)}%` : '—'} />,
      /* Hit % (L) */ <NumericCell value={league.hit_rate_lenient ? `${league.hit_rate_lenient.toFixed(1)}%` : '—'} />,
      /* Lift */ (
        <NumericCell
          value={league.lift_over_baseline ? `${league.lift_over_baseline > 0 ? '+' : ''}${league.lift_over_baseline.toFixed(1)}` : '—'}
          color={league.lift_over_baseline > 0 ? COLORS.green : league.lift_over_baseline < 0 ? COLORS.red : COLORS.dim}
        />
      ),
      /* Status */ (
        <Badge
          value={league.status || 'Insufficient'}
          color={league.status === 'Consistent' ? 'green' : league.status === 'Volatile' ? 'orange' : 'gray'}
          size="sm"
        />
      ),
    ],
  }));

  return (
    <ResponsiveTableWrapper>
      <OptimizedTable headers={headers} rows={rows} minWidth="100%" />
    </ResponsiveTableWrapper>
  );
}

// ─── CSS INJECTION (add to global styles) ──────────────────────────────────

const CSS_TOUCH_SCROLL = `
  .touch-scroll-momentum {
    -webkit-overflow-scrolling: touch;
    overflow-x: auto;
    width: 100%;
    max-width: 100%;
  }
  
  /* Disable default scrollbar for cleaner look */
  .touch-scroll-momentum::-webkit-scrollbar {
    display: none;
  }
  
  /* Optional: thin scrollbar for desktop */
  @media (hover: hover) {
    .touch-scroll-momentum::-webkit-scrollbar {
      display: block;
      height: 4px;
    }
    
    .touch-scroll-momentum::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .touch-scroll-momentum::-webkit-scrollbar-thumb {
      background: #475569;
      border-radius: 2px;
    }
    
    .touch-scroll-momentum::-webkit-scrollbar-thumb:hover {
      background: #64748b;
    }
  }
`;

export function injectTouchScrollCSS() {
  if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = CSS_TOUCH_SCROLL;
    document.head.appendChild(style);
  }
}

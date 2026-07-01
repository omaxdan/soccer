'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  {
    section: 'INTELLIGENCE',
    items: [
      { href: '/matches/picks', icon: '🎯', label: 'Match Picks' },
      { href: '/matches',       icon: '⚡', label: 'Match Intelligence' },
      { href: '/teams',         icon: '🛡', label: 'Team Intelligence' },
      { href: '/compare',       icon: '↔', label: 'Team Comparison' },
      { href: '/leagues',       icon: '🏆', label: 'League Overview' },
      { href: '/players',       icon: '👤', label: 'Player Intelligence' },
    ],
  },
  {
    section: 'DATA',
    items: [
      { href: '/matches',      icon: '📅', label: 'Matches' },
      { href: '/teams',        icon: '🏟', label: 'Teams' },
      { href: '/leagues',      icon: '🎯', label: 'Tournaments' },
      { href: '/players',      icon: '👥', label: 'Players' },
      { href: '/stadiums',     icon: '📍', label: 'Stadiums' },
    ],
  },
  {
    section: 'ANALYTICS',
    items: [
      { href: '/intel/form',        icon: '📈', label: 'Form Guide' },
      { href: '/intel/congestion',  icon: '🔴', label: 'Fixture Congestion' },
      { href: '/intel/travel',      icon: '✈', label: 'Travel Analysis' },
      { href: '/squad-stability',   icon: '🔵', label: 'Squad Stability' },
    ],
  },
  {
    section: 'SETTINGS',
    items: [
      { href: '/watchlist',    icon: '⭐', label: 'Watchlist' },
      { href: '/alerts',       icon: '🔔', label: 'Alerts' },
      { href: '/settings',     icon: '⚙', label: 'Preferences' },
    ],
  },
];

export default function Sidebar() {
  const path = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return path === '/';
    return path.startsWith(href);
  };

  return (
    <aside className="app-sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <Link href="/" className="sidebar-logo-mark" style={{ textDecoration: 'none' }}>
          <div className="sidebar-logo-icon">R</div>
          <div className="sidebar-logo-text">RiP</div>
        </Link>
        <div className="sidebar-logo-sub">Readiness Intelligence<br />Platform</div>
      </div>

      {/* Nav sections */}
      {NAV.map((group, gi) => (
        <div key={gi} className={gi === NAV.length - 1 ? 'sidebar-section-last' : 'sidebar-section'}>
          <div className="sidebar-label">{group.section}</div>
          {group.items.map(item => (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={`sidebar-item${isActive(item.href) ? ' active' : ''}`}
            >
              <span style={{ fontSize: 13, width: 16, textAlign: 'center' }}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      ))}

      {/* Data status */}
      <div className="sidebar-data-status">
        <div className="data-status-label">Data Status</div>
        <div className="data-status-row" style={{ marginBottom: 4 }}>
          <div className="status-dot" />
          <span>All Systems Operational</span>
        </div>
        <div className="data-status-row" style={{ color: 'var(--dim)', fontSize: 10 }}>
          <span>Last Update: 2 min ago</span>
          <span style={{ marginLeft: 'auto', cursor: 'pointer', color: 'var(--blue)' }}>↻</span>
        </div>
      </div>
    </aside>
  );
}

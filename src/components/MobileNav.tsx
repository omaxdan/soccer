'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COLORS } from '@/design/tokens';

const TABS = [
  { href: '/',        icon: '🏠', label: 'Today' },
  { href: '/matches', icon: '🎯', label: 'Matches' },
  { href: '/intel',   icon: '📊', label: 'Intel' },
  { href: '/betting', icon: '🎲', label: 'Betting' },
  { href: '/search',  icon: '🔍', label: 'Search' },
];

export default function MobileNav() {
  const path = usePathname();

  return (
    <nav style={{
      display: 'none',  // shown via @media in globals.css
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 300,
      background: COLORS.surface,
      borderTop: `1px solid ${COLORS.border}`,
      padding: '6px 0 env(safe-area-inset-bottom)',
    }}
    className="mobile-nav"
    >
      <style>{`
        @media (max-width: 768px) {
          .mobile-nav { display: flex !important; }
          .desktop-sidebar { display: none !important; }
        }
      `}</style>
      {TABS.map(tab => {
        const active = tab.href === '/' ? path === '/' : path.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            padding: '6px 0',
            color: active ? COLORS.green : COLORS.muted,
            textDecoration: 'none',
          }}>
            <span style={{ fontSize: 20 }}>{tab.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

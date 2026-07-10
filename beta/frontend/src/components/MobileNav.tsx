'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { COLORS } from '@/design/tokens';
import { TodayIcon, MatchesIcon, IntelIcon, BettingIcon, SearchIcon } from '@/components/NavIcons';

const TABS = [
  { href: '/',        Icon: TodayIcon,   label: 'Today' },
  { href: '/matches', Icon: MatchesIcon, label: 'Matches' },
  { href: '/intel',   Icon: IntelIcon,   label: 'Intel' },
  { href: '/betting', Icon: BettingIcon, label: 'Betting' },
  { href: '/search',  Icon: SearchIcon,  label: 'Search' },
];

export default function MobileNav() {
  const path = usePathname();

  return (
    <nav style={{
      display: 'none',  // shown via the @media block in this component's own <style> tag below
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
          .app-sidebar { display: none !important; }
        }
      `}</style>
      {TABS.map(({ href, Icon, label }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            padding: '6px 0',
            color: active ? COLORS.green : COLORS.muted,
            textDecoration: 'none',
          }}>
            <Icon size={20} />
            <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

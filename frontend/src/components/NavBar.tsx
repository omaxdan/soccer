'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { COLORS, TYPE } from '@/design/tokens';

const NAV_LINKS = [
  { href: '/matches',          label: 'Matches' },
  { href: '/teams',            label: 'Teams' },
  { href: '/leagues',          label: 'Leagues' },
  { href: '/intel',            label: 'Intel ▾', dropdown: [
    { href: '/intel/travel',      label: 'Travel Hub' },
    { href: '/intel/congestion',  label: 'Congestion Hub' },
    { href: '/intel/form',        label: 'Form Hub' },
  ]},
  { href: '/betting',          label: 'Betting' },
];

export default function NavBar() {
  const path = usePathname();
  const [intelOpen, setIntelOpen] = useState(false);

  const isActive = (href: string) =>
    href === '/intel'
      ? path.startsWith('/intel')
      : path === href || (href !== '/' && path.startsWith(href));

  return (
    <nav style={{
      background: COLORS.surface,
      borderBottom: `1px solid ${COLORS.border}`,
      height: 52,
      display: 'flex', alignItems: 'center',
      padding: '0 24px',
      position: 'sticky', top: 0, zIndex: 200,
      gap: 0,
    }}>
      {/* Left: Logo */}
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 32, textDecoration: 'none' }}>
        <div style={{
          width: 30, height: 30,
          background: COLORS.green,
          borderRadius: 7,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...TYPE.mono, fontWeight: 700, fontSize: 14, color: '#000',
        }}>R</div>
        <span style={{ ...TYPE.mono, fontWeight: 700, fontSize: 14, color: COLORS.text, letterSpacing: '0.04em' }}>
          NINETYDATA
        </span>
        <span style={{
          background: COLORS.purple + '20', color: COLORS.purple,
          border: `1px solid ${COLORS.purple}40`,
          borderRadius: 4, padding: '1px 6px',
          fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>BETA</span>
      </Link>

      {/* Center: Navigation links */}
      <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: 0 }}>
        {NAV_LINKS.map(link => {
          const active = isActive(link.href);
          return (
            <div key={link.href} style={{ position: 'relative' }}>
              {link.dropdown ? (
                <button
                  onClick={() => setIntelOpen(v => !v)}
                  style={{
                    height: 52, padding: '0 14px',
                    color: active ? COLORS.green : COLORS.muted,
                    fontSize: 12, fontWeight: 600,
                    borderBottom: `2px solid ${active ? COLORS.green : 'transparent'}`,
                    textTransform: 'uppercase', letterSpacing: '0.07em',
                    transition: 'all 0.15s',
                    cursor: 'pointer',
                  }}
                >
                  {link.label}
                </button>
              ) : (
                <Link href={link.href} style={{
                  height: 52, padding: '0 14px',
                  display: 'flex', alignItems: 'center',
                  color: active ? COLORS.green : COLORS.muted,
                  fontSize: 12, fontWeight: 600,
                  borderBottom: `2px solid ${active ? COLORS.green : 'transparent'}`,
                  textTransform: 'uppercase', letterSpacing: '0.07em',
                  transition: 'all 0.15s',
                }}>
                  {link.label}
                </Link>
              )}

              {/* Dropdown */}
              {link.dropdown && intelOpen && (
                <div style={{
                  position: 'absolute', top: 52, left: 0,
                  background: COLORS.surface2,
                  border: `1px solid ${COLORS.border2}`,
                  borderRadius: 10, overflow: 'hidden',
                  minWidth: 180, zIndex: 300,
                  boxShadow: '0 8px 24px #0004',
                }}>
                  {link.dropdown.map(d => (
                    <Link key={d.href} href={d.href}
                      onClick={() => setIntelOpen(false)}
                      style={{
                        display: 'block', padding: '10px 16px',
                        fontSize: 12, color: COLORS.muted, fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                        borderBottom: `1px solid ${COLORS.border}`,
                      }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = COLORS.text}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = COLORS.muted}
                    >
                      {d.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right: Search, Alerts, Account */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Link href="/search" style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: COLORS.surface2, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, padding: '5px 12px',
          fontSize: 11, color: COLORS.muted, cursor: 'pointer',
        }}>
          🔍 Search
        </Link>
        <button style={{
          background: COLORS.surface2, border: `1px solid ${COLORS.border}`,
          borderRadius: 8, padding: '5px 10px',
          fontSize: 14, color: COLORS.muted, cursor: 'pointer',
        }} title="Alerts">🔔</button>
        <div style={{
          width: 30, height: 30,
          background: COLORS.blue + '30', border: `1px solid ${COLORS.blue}50`,
          borderRadius: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: COLORS.blue, cursor: 'pointer',
        }}>U</div>
      </div>
    </nav>
  );
}

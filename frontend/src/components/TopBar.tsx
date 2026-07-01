'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Crumb { label: string; href?: string; }
interface Props { crumbs?: Crumb[]; title?: string; actions?: React.ReactNode; }

export default function TopBar({ crumbs, title, actions }: Props) {
  const [theme, setTheme] = useState<'dark'|'light'>('dark');
  const [time, setTime]   = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('rip_theme') as 'dark'|'light'|null;
      if (saved) { setTheme(saved); document.documentElement.setAttribute('data-theme', saved); }
    } catch {}
    const tick = () => setTime(new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false }));
    tick();
    const t = setInterval(tick, 30000);
    return () => clearInterval(t);
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('rip_theme', next); } catch {}
  };

  const dateStr = new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });

  return (
    <div className="app-topbar">
      {crumbs && crumbs.length > 0 ? (
        <div className="topbar-breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} style={{ display:'flex', alignItems:'center', gap:6 }}>
              {i > 0 && <span className="topbar-sep">›</span>}
              {c.href
                ? <Link href={c.href} style={{ color:'var(--muted)' }}>{c.label}</Link>
                : <span className="current">{c.label}</span>}
            </span>
          ))}
        </div>
      ) : title ? (
        <div style={{ fontWeight:700, fontSize:14 }}>{title}</div>
      ) : null}

      <div className="topbar-actions">
        {actions}
        <div className="topbar-status"><div className="status-dot" /><span>Live</span></div>
        <div className="topbar-date">{dateStr}{time ? ` · ${time}` : ''}</div>
        <button className="theme-toggle" onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </div>
  );
}

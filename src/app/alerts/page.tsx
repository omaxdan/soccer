export const metadata = { title: 'Alerts' };

export default function AlertsPage() {
  const alerts = [
    { type: 'travel', icon: '✈', color: 'var(--amber)', title: 'High Travel Alert', desc: 'Brentford traveled 377km for today\'s match vs Liverpool', time: '2h ago', severity: 'moderate' },
    { type: 'congestion', icon: '📅', color: 'var(--red)', title: 'Fixture Congestion', desc: 'Newcastle Utd: 7 matches in next 14 days — congestion critical', time: '4h ago', severity: 'high' },
    { type: 'rest', icon: '🛏', color: 'var(--green)', title: 'Rest Advantage Detected', desc: 'Liverpool: +3.1 days more rest than opponent ahead of next match', time: '6h ago', severity: 'positive' },
    { type: 'readiness', icon: '⚡', color: 'var(--blue)', title: 'Readiness Updated', desc: 'Intelligence recalculated for 256 teams — 2 min ago', time: 'just now', severity: 'info' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>🔔 Alerts</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>{alerts.length} recent alerts</div>
        </div>
        <button style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>
          Mark all read
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {alerts.map((a, i) => (
          <div key={i} className="card" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: a.color + '20', border: `1px solid ${a.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
              {a.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{a.title}</span>
                <span style={{ fontSize: 10, color: 'var(--dim)' }}>{a.time}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{a.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ background: 'var(--purple)10', border: '1px solid var(--purple)30' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--purple)', marginBottom: 6 }}>🔒 Pro Alert Features</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Set custom thresholds for travel, congestion, and readiness alerts. Get notified via email or push notification.
        </div>
        <button style={{ background: 'var(--purple)', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 700 }}>
          Upgrade to Pro →
        </button>
      </div>
    </div>
  );
}

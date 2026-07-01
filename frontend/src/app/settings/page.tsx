export const metadata = { title: 'Settings' };

export default function SettingsPage() {
  const sections = [
    { title: 'PREFERENCES', items: [
      { label: 'Display Units', desc: 'Metric (km) or Imperial (miles)', value: 'Metric (km)' },
      { label: 'Default Date Range', desc: 'How many days of history to show by default', value: 'Last 14 days' },
      { label: 'Theme', desc: 'Visual theme for the platform', value: 'Dark' },
      { label: 'Time Zone', desc: 'Displayed match times', value: 'Local (auto)' },
    ]},
    { title: 'ALERTS', items: [
      { label: 'Email Notifications', desc: 'Daily intelligence digest', value: 'Enabled' },
      { label: 'Travel Alert Threshold', desc: 'Alert when away team travels more than', value: '500 km' },
      { label: 'Congestion Alert', desc: 'Alert when congestion score exceeds', value: '70/100' },
      { label: 'Readiness Change', desc: 'Alert when readiness changes by more than', value: '10 pts' },
    ]},
    { title: 'ACCOUNT', items: [
      { label: 'Plan', desc: 'Current subscription', value: 'Pro Plan' },
      { label: 'API Access', desc: 'Programmatic access to intelligence data', value: 'Enabled' },
      { label: 'Data Export', desc: 'Download intelligence data as CSV/JSON', value: 'Available' },
    ]},
    { title: 'DATA & CALCULATIONS', items: [
      { label: 'Readiness Weights', desc: 'Customize how readiness score is computed', value: 'Default' },
      { label: 'Intelligence Cache', desc: 'How long to cache computed intelligence', value: '30 min' },
      { label: 'Data Source', desc: 'Primary data provider', value: 'SportsAPI Pro' },
    ]},
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Settings</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>Manage your account and preferences</div>
      </div>

      {/* Data status summary */}
      <div className="card" style={{ background: 'var(--green)10', border: '1px solid var(--green)30' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>All Systems Operational</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Intelligence data is up to date. Last sync: 2 min ago.</div>
          </div>
        </div>
      </div>

      {sections.map(section => (
        <div key={section.title}>
          <div className="section-label" style={{ marginBottom: 10 }}>{section.title}</div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {section.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: i < section.items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{item.desc}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{item.value}</span>
                  <span style={{ color: 'var(--dim)', fontSize: 14 }}>›</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Logout */}
      <div style={{ paddingTop: 8 }}>
        <button style={{ color: 'var(--red)', background: 'var(--red)12', border: '1px solid var(--red)30', borderRadius: 8, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          ↩ Log Out
        </button>
      </div>
    </div>
  );
}

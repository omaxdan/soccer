import { COLORS, TYPE } from '@/design/tokens';
import { supabase } from '@/lib/supabase';

async function getLastUpdated(): Promise<string | null> {
  const { data } = await supabase
    .from('team_intelligence')
    .select('calculated_at')
    .order('calculated_at', { ascending: false })
    .limit(1)
    .single();
  return data?.calculated_at ?? null;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function freshnessColor(iso: string): string {
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hrs < 2) return COLORS.green;
  if (hrs < 12) return COLORS.amber;
  return COLORS.red;
}

export default async function DataFreshness() {
  const ts = await getLastUpdated().catch(() => null);
  if (!ts) return null;

  const color = freshnessColor(ts);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          border: `1px solid ${color}40`,
          borderRadius: 20,
          padding: '3px 11px',
          background: `${color}10`,
          ...TYPE.smallData,
        }}
      >
        <span style={{ color, fontSize: 8 }}>●</span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>
          Intelligence last updated: <span style={{ fontWeight: 600, color }}>{relTime(ts)}</span>
        </span>
      </div>
    </div>
  );
}
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
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function freshnessClass(iso: string): string {
  const hrs = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hrs < 2)  return 'freshness-fresh';
  if (hrs < 12) return 'freshness-stale';
  return 'freshness-old';
}

export default async function DataFreshness() {
  const ts = await getLastUpdated().catch(() => null);
  if (!ts) return null;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
      <div
        className={freshnessClass(ts)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          border: '1px solid',
          borderRadius: 20,
          padding: '3px 11px',
          fontSize: 11,
          ...TYPE.smallData,
        }}
      >
        <span>●</span>
        <span>Intelligence last updated: {relTime(ts)}</span>
      </div>
    </div>
  );
}

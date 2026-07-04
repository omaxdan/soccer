'use client';
import { useState } from 'react';
import QuoteHero from '@/components/QuoteHero';
import StatGrid from '@/components/StatGrid';
import Tabs from '@/components/Tabs';
import RelatedPills from '@/components/RelatedPills';
import { COLORS } from '@/design/tokens';

const TABS = ['Overview', 'Squad', 'Fixtures'];

// Realistic mock data, shaped like a real team_intelligence_history trend —
// standing in for a real fetch so this page previews the pattern without
// depending on any specific team having a full data set synced.
const MOCK_TREND = [58, 61, 59, 64, 67, 65, 70, 74].map(value => ({ value }));

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16 }}>{children}</div>;
}

/** Preview/reference page for the new mobile-first "quote page" pattern —
 *  QuoteHero + Sparkline + StatGrid + Tabs + RelatedPills, all built as
 *  reusable components before being applied to the real Team/Match
 *  Detail pages. Resize the browser (or open on an actual phone) to see
 *  StatGrid reflow via auto-fit/minmax with zero extra breakpoint code,
 *  and the tab bar go horizontally scrollable instead of wrapping.
 *  Delete this page once the real pages have been migrated to the
 *  pattern and it's no longer needed as a live reference. */
export default function StyleGuidePage() {
  const [tab, setTab] = useState('Overview');

  return (
    <div style={{ padding: '20px 24px', maxWidth: 480, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>Quote Page Pattern — Preview</div>
        <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>
          Mobile-first hero + stats + tabs, built as reusable components. Not wired to real data yet — resize this window to see it reflow.
        </div>
      </div>

      <Card>
        <QuoteHero
          value={74}
          label="Shamrock Rovers · Readiness"
          change={4}
          changeLabel="vs baseline"
          trend={MOCK_TREND}
        />
      </Card>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Overview' && (
        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Key Stats
          </div>
          <StatGrid items={[
            { label: 'Form Index', value: 57, scoreColored: true },
            { label: 'Strength', value: 71, scoreColored: true },
            { label: 'Congestion', value: 0, scoreColored: true },
            { label: 'Squad Stability', value: 99, scoreColored: true },
            { label: 'Goals Scored', value: 38 },
            { label: 'Goals Conceded', value: 21 },
            { label: 'Venue Advantage', value: 64 },
            { label: 'Squad Depth', value: 97, scoreColored: true },
          ]} />
        </Card>
      )}

      {tab === 'Squad' && (
        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Key Players
          </div>
          <StatGrid dense items={[
            { label: 'J. Byrne', value: '21.9', suffix: '%' },
            { label: 'M. Healy', value: '19.8', suffix: '%' },
            { label: 'Pico', value: '19.3', suffix: '%' },
            { label: 'E. McGinty', value: '18.5', suffix: '%' },
          ]} />
        </Card>
      )}

      {tab === 'Fixtures' && (
        <Card>
          <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Next Opponent
          </div>
          <div style={{ fontSize: 12, color: COLORS.text2 }}>Bohemian FC · Sat 18:45</div>
        </Card>
      )}

      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Related Teams
        </div>
        <RelatedPills items={[
          { href: '/teams', label: 'Bohemian FC', value: 78, valueColor: COLORS.green },
          { href: '/teams', label: 'St Patrick\'s Athletic', value: 65, valueColor: COLORS.amber },
          { href: '/teams', label: 'Derry City', value: 71, valueColor: COLORS.greenDim },
        ]} />
      </div>
    </div>
  );
}

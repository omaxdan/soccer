// MATCH OVERVIEW — header + server-rendered Overview surfaces (read-only, SSR).
//
// The permanent state-aware MatchHeader (identity ×2, score with HT + AET/PEN
// qualifiers, status chip, context line, venue / result-confirmation footer) plus the
// non-interactive Overview pieces: Team features (mirrored compare, stronger side bold
// by the governed direction) and the rail Result card. The interactive Overview pieces
// (recent form, match factors, venue form) live in matchClient.tsx; historical patterns
// live in intelligence.tsx.
//
// Discipline: no football is COMPUTED here. Values are the API's; the only arithmetic
// is presentation. A missing value is an honest "—" / "Not available", never a
// fabricated number, never a backend code, never a prediction. Design tokens only.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { Kickoff } from '@/components/v2/ui';
import { statusPresentation } from '@/lib/v2/fixtures';
import type {
  MatchDetailResponse, MatchResult, MatchVenueInfo, ApiFeatureValue, MetricDirection,
} from '@/lib/v2/types';

/** Match status chip using the app-wide (Phase C) grammar: COMPLETED → FT (or AET/PEN
 *  when the result carries extra time / penalties), SCHEDULED → UPCOMING, IN_PROGRESS →
 *  LIVE, etc. Text + colour, never colour alone. */
function MatchStatusChip({ status, result }: { status: string; result: MatchResult | null }) {
  const p = statusPresentation(status, result);
  return (
    <span className="mono" aria-label={p.word}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: p.color, border: `1px ${p.dashed ? 'dashed' : 'solid'} ${p.color}`, borderRadius: 4, padding: '1px 7px' }}>
      <span aria-hidden style={{ fontSize: 8, animation: p.live ? 'pulse-dot 1.8s ease-in-out infinite' : 'none' }}>{p.glyph}</span>{p.label}
    </span>
  );
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

// ═══ MATCH HEADER (permanent across all tabs) ════════════════════════════════════════

export function MatchHeader({ context, venue, result = null }: {
  context: MatchDetailResponse; venue: MatchVenueInfo | null; result?: MatchResult | null;
}) {
  const { match } = context;
  const completed = match.status === 'COMPLETED';
  const score = match.score;
  const place = venue ? [venue.name, venue.city].filter(Boolean).join(' · ') : null;
  const ht = result?.halfTime ?? null;
  const scoreLabel = completed && score ? `${match.homeTeam.name} ${score.home}, ${match.awayTeam.name} ${score.away}` : undefined;
  return (
    <header className={`panel${completed ? ' scanlines' : ''}`} style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <Link href={routes.competition(match.competition)} className="eyebrow" style={{ color: 'var(--muted)', textDecoration: 'none' }}>{match.competition.name}</Link>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{match.edition.seasonLabel}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14, alignItems: 'center', marginTop: 14 }}>
        <div style={{ textAlign: 'right', minWidth: 0 }}>
          <Link href={routes.team(match.homeTeam)} style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)', textDecoration: 'none' }}>{match.homeTeam.name}</Link>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 2 }}>Home</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          {completed && score
            ? <div className="mono tnum" aria-label={scoreLabel} style={{ fontSize: 34, fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>{score.home}<span style={{ color: 'var(--faint)', margin: '0 8px' }}>–</span>{score.away}</div>
            : completed
              ? <div className="mono" aria-label="No score recorded" style={{ fontSize: 30, color: 'var(--faint)', lineHeight: 1 }}>—</div>
              : <div className="label-cap" style={{ fontSize: 16, color: 'var(--faint)' }}>vs</div>}
          <div style={{ marginTop: 8, display: 'flex', gap: 5, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
            <MatchStatusChip status={match.status} result={result} />
            {result?.extraTime ? <span className="label-cap" style={{ color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 4, padding: '0 5px', fontSize: 8 }}>AET</span> : null}
            {result?.penalties ? <span className="label-cap" style={{ color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 4, padding: '0 5px', fontSize: 8 }}>PEN</span> : null}
          </div>
          {ht && <div className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 4 }}>HT {ht.home} – {ht.away}</div>}
        </div>
        <div style={{ textAlign: 'left', minWidth: 0 }}>
          <Link href={routes.team(match.awayTeam)} style={{ fontWeight: 700, fontSize: 20, color: 'var(--text)', textDecoration: 'none' }}>{match.awayTeam.name}</Link>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 2 }}>Away</p>
        </div>
      </div>

      <p className="label-cap tnum" style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 12 }}>
        <Kickoff iso={match.kickoffAt} />
        {place
          ? <> · {venue ? <Link href={routes.venue(venue)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{place}</Link> : place}{venue?.countryCode ? <span style={{ color: 'var(--faint)' }}> · {venue.countryCode}</span> : null}</>
          : <> · <span style={{ color: 'var(--faint)' }}>Venue not supplied</span></>}
        {result?.confirmedAt ? <span style={{ color: 'var(--faint)' }}> · result confirmed <Kickoff iso={result.confirmedAt} /></span> : null}
      </p>
    </header>
  );
}

// ═══ TEAM FEATURES — mirrored compare, stronger side bold by governed direction ══════

/** Decide which side is stronger for a feature, using the GOVERNED direction only.
 *  UNSIGNED (or a tie / a missing value) → neither side is highlighted. */
function stronger(home: ApiFeatureValue | null, away: ApiFeatureValue | null, direction: MetricDirection): 'home' | 'away' | null {
  if (!home || !away || direction === 'UNSIGNED' || home.value === away.value) return null;
  const homeHigher = home.value > away.value;
  if (direction === 'HIGHER_IS_STRONGER') return homeHigher ? 'home' : 'away';
  return homeHigher ? 'away' : 'home'; // LOWER_IS_STRONGER
}

function FeatureCell({ v, better, align }: { v: ApiFeatureValue | null; better: boolean; align: 'right' | 'left' }) {
  return (
    <div style={{ textAlign: align }}>
      <span className="mono tnum" style={{ fontSize: 15, fontWeight: better ? 700 : 500, color: v ? (better ? 'var(--text)' : 'var(--text-secondary)') : 'var(--faint)' }}>
        {v ? fmtNum(v.value) : '—'}
      </span>
      {v ? <div className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{v.sampleMeetsThreshold ? `${v.sampleObservationCount} obs` : 'low sample'}</div> : null}
    </div>
  );
}

function FeatureRow({ label, home, away, direction }: {
  label: string; home: ApiFeatureValue | null; away: ApiFeatureValue | null; direction: MetricDirection;
}) {
  const s = stronger(home, away, direction);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <FeatureCell v={home} better={s === 'home'} align="right" />
      <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10, textAlign: 'center', minWidth: 96 }}>{label}</span>
      <FeatureCell v={away} better={s === 'away'} align="left" />
    </div>
  );
}

/** Mirrored home/away feature comparison. The stronger side (by the feature's governed
 *  direction) is brighter and bold; a low-sample value is flagged. Nothing is computed —
 *  the direction is the backend's, and a UNSIGNED feature highlights neither side. */
export function TeamFeatureCompare({ detail }: { detail: MatchDetailResponse }) {
  const h = detail.teamFeatures.home;
  const a = detail.teamFeatures.away;
  const dir = (v: ApiFeatureValue | null): MetricDirection => v?.direction ?? 'UNSIGNED';
  return (
    <section className="space-y-2" aria-label="team features">
      <p className="eyebrow">Team features</p>
      <div className="panel" style={{ padding: '4px 16px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10, alignItems: 'baseline', paddingTop: 8 }}>
          <span style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{detail.match.homeTeam.name}</span>
          <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, minWidth: 96, textAlign: 'center' }}>feature</span>
          <span style={{ textAlign: 'left', fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>{detail.match.awayTeam.name}</span>
        </div>
        <FeatureRow label="Home form" home={h.homeForm} away={a.homeForm} direction={dir(h.homeForm ?? a.homeForm)} />
        <FeatureRow label="Away form" home={h.awayForm} away={a.awayForm} direction={dir(h.awayForm ?? a.awayForm)} />
        <FeatureRow label="Momentum" home={h.momentum} away={a.momentum} direction={dir(h.momentum ?? a.momentum)} />
        <FeatureRow label="Rest (days)" home={h.rest} away={a.rest} direction={dir(h.rest ?? a.rest)} />
        <FeatureRow label="Congestion" home={h.congestion} away={a.congestion} direction={dir(h.congestion ?? a.congestion)} />
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        The brighter, bolder side is stronger by the feature's own definition — context, not a forecast.
      </p>
    </section>
  );
}

// ═══ RESULT CARD (rail) ══════════════════════════════════════════════════════════════

function ResultLine({ label, s, bold = false }: { label: string; s: { home: number; away: number } | null; bold?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'baseline', padding: '4px 0' }}>
      <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</span>
      <span className="mono tnum" style={{ color: s ? 'var(--text)' : 'var(--faint)', fontWeight: bold ? 700 : 500, textAlign: 'right' }}>{s ? `${s.home} – ${s.away}` : '—'}</span>
    </div>
  );
}

/** The result card for the Overview rail: full time / half time / extra time /
 *  penalties + confirmation time. For a not-yet-played fixture, an honest status note. */
export function ResultCard({ detail, result }: { detail: MatchDetailResponse; result: MatchResult | null }) {
  const completed = detail.match.status === 'COMPLETED';
  return (
    <section className="space-y-2" aria-label="result">
      <p className="eyebrow">Result</p>
      <div className="panel" style={{ padding: 12 }}>
        {completed && result ? (
          <>
            <ResultLine label="Full time" s={result.final} bold />
            <ResultLine label="Half time" s={result.halfTime} />
            {result.extraTime ? <ResultLine label="Extra time" s={result.extraTime} /> : null}
            {result.penalties ? <ResultLine label="Penalties" s={result.penalties} /> : null}
            {result.confirmedAt && <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>Confirmed <Kickoff iso={result.confirmedAt} /></p>}
          </>
        ) : (
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 11 }}>
            {completed ? 'No result recorded for this fixture.' : 'Not yet played — the result appears once the fixture is complete.'}
          </p>
        )}
      </div>
    </section>
  );
}

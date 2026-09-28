// TEAM ENTITY HUB — presentational components (read-only, SSR).
//
// Numbers-first Layer-1/Layer-3 surfaces for the Team page. Strict separation:
//   IDENTITY   — who the team is (name, country, home venue, competitions).
//   CONTEXT    — competition participation, venue name, fixtures, players.
//   EVIDENCE   — raw match results, recent home/away fixtures, descriptive
//                performance FEATURES (persisted, not recomputed here).
//   INTELLIGENCE — the GOVERNED readiness reading only, clearly badged and never
//                merged with the evidence around it.
//
// Every value is rendered exactly as the API supplied it: no aggregation, ranking,
// zero-fill, prediction, probability, travel/distance, or betting language. Nullable
// fields render as an em dash. Links go through the centralized route helpers.

import Link from 'next/link';
import { routes } from '@/lib/v2/routes';
import { Kickoff, EmptyState, EvidencePanel } from '@/components/v2/ui';
import { lineGoals, lineResult, lineMatchFixture } from '@/lib/v2/team';
import { TEAM_TABS, teamTabHref, type TeamTab } from '@/lib/v2/teamTabs';
import type {
  PerformanceMetric, StandingLine,
  TeamAvailabilityRecord, TeamDetailResponse, TeamFixtureLine, TeamGovernedReading, TeamIntelligence, TeamParticipation,
  TeamPerformanceOverall, TeamReadinessReading,
  StatisticalAttributesBlock, StatisticalAttribute,
  ResultAttribute, TeamPlayerObservation, CompetitionPerformance,
} from '@/lib/v2/types';

/** One edition's standings context for this team: its row (or null if not in the snapshot). */
export interface TeamStandingEntry {
  readonly editionId: string;
  readonly seasonLabel: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly line: StandingLine | null;
}

// ── shared bits ───────────────────────────────────────────────────────────────────

function Tag({ kind }: { kind: 'context' | 'governed' }) {
  const color = kind === 'governed' ? 'var(--edge)' : 'var(--cool)';
  return <span className="label-cap" style={{ color, border: `1px solid ${color}`, borderRadius: 4, padding: '0 5px', fontSize: 9 }}>{kind === 'governed' ? 'governed' : 'context'}</span>;
}

function Eyebrow({ label, kind = 'context', count }: { label: string; kind?: 'context' | 'governed'; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <p className="eyebrow">{label}</p>
      <Tag kind={kind} />
      {typeof count === 'number' && <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{count}</span>}
    </div>
  );
}

function orDash(v: string | number | null | undefined): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function FormLetter({ res }: { res: 'W' | 'D' | 'L' | null }) {
  const map = { W: 'var(--edge)', D: 'var(--muted)', L: 'var(--risk)' } as const;
  const color = res ? map[res] : 'var(--faint)';
  return <span className="mono" style={{ fontWeight: 700, color, minWidth: 12, textAlign: 'center' }}>{res ?? '·'}</span>;
}

const th: React.CSSProperties = { textAlign: 'left', color: 'var(--faint)', fontWeight: 600, padding: '4px 6px' };
const td: React.CSSProperties = { padding: '4px 6px', color: 'var(--text)', whiteSpace: 'nowrap' };

// ═══ IDENTITY ══════════════════════════════════════════════════════════════════════
//
// The Team workspace header: a neutral monogram (no crest field exists in the data
// model), the team name, short name and home venue (plain text — the Venue page is a
// later phase), the competition·season link(s), and a latest-match / next-fixture line.
// Table position and win-rate are intentionally NOT shown here (coverage.standings is
// not-supported for this feed). Everything is read verbatim; nothing is computed.

/** A neutral team monogram (initials) — the V2 data model carries no crest, so this is
 *  an honest compact mark, never an invented image. */
function TeamMonogram({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 3).map((w) => w[0]).join('').toUpperCase().slice(0, 3) || '•';
  return (
    <span aria-hidden className="mono" style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
      width: 52, height: 52, borderRadius: 6, fontSize: 15, fontWeight: 700,
      color: 'var(--amber)', background: 'color-mix(in srgb, var(--amber) 10%, var(--panel))', border: '1px solid var(--line)',
    }}>{initials}</span>
  );
}

/** A compact UTC match date, e.g. "6 Sep 2026". */
function matchDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function TeamIdentityHeader({ team, competitions, latestMatchAt, nextFixture }: {
  team: TeamDetailResponse['team'];
  competitions: TeamDetailResponse['competitions'];
  latestMatchAt: string | null;
  nextFixture: TeamIntelligence['nextFixture'];
}) {
  return (
    <header className="panel" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, minWidth: 0 }}>
        <TeamMonogram name={team.name} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(20px,3vw,26px)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{team.name}</h1>
          <p className="label-cap" style={{ color: 'var(--muted)', margin: 0 }}>
            {team.shortName && team.shortName !== team.name ? <>{team.shortName}</> : null}
            {team.homeVenueName ? <>{team.shortName && team.shortName !== team.name ? ' · ' : ''}{team.homeVenueName}</> : null}
          </p>
          {competitions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {competitions.map((c) => (
                <Link
                  key={c.editionId}
                  href={routes.edition({ id: c.editionId, competition: { slug: c.competition.slug }, seasonLabel: c.seasonLabel })}
                  className="label-cap"
                  style={{ color: 'var(--cool)', border: '1px solid var(--line)', borderRadius: 4, padding: '2px 7px', textDecoration: 'none' }}
                >
                  {c.competition.name} · {c.seasonLabel}
                </Link>
              ))}
            </div>
          )}
          <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 10, margin: 0 }}>
            {latestMatchAt ? `Latest match ${matchDate(latestMatchAt)}` : 'No completed matches recorded'}
            {' · '}
            {nextFixture ? <>Next fixture <Kickoff iso={nextFixture.fixture.kickoffAt} /></> : 'Next fixture: none recorded'}
          </p>
        </div>
      </div>
    </header>
  );
}


// ═══ COMPETITION CONTEXT — participation counts per governed edition ═════════════════

export function TeamCompetitionContext({ participation }: { participation: readonly TeamParticipation[] }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Competition context" count={participation.length} />
      {participation.length === 0 ? (
        <EmptyState message="No governed participation recorded yet." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr>
              <th style={th}>Competition</th><th style={th}>Season</th>
              <th style={th}>P</th><th style={th}>Completed</th><th style={th}>Scheduled</th><th style={th}>Postp.</th><th style={th}>Reg.</th><th style={th}>Window</th>
            </tr></thead>
            <tbody>
              {participation.map((p) => (
                <tr key={p.competitionEditionId}>
                  <td style={td}><Link href={routes.competition(p.competition)} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.competition.name}</Link></td>
                  <td style={td}>
                    <Link href={routes.edition({ id: p.competitionEditionId, competition: { slug: p.competition.slug }, seasonLabel: p.seasonLabel })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.seasonLabel}</Link>
                  </td>
                  <td style={td}>{p.fixturesTotal}</td><td style={td}>{p.completed}</td><td style={td}>{p.scheduled}</td><td style={td}>{p.postponed}</td>
                  <td style={td}>{p.registered ? '✓' : '—'}</td>
                  <td style={{ ...td, whiteSpace: 'normal' }}>
                    {/* First/last kickoff of THIS team's fixtures in the edition — verbatim API dates,
                        never a computed span or "remaining fixtures" subtraction. */}
                    {p.firstKickoff || p.lastKickoff ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{p.firstKickoff ? <>first <Kickoff iso={p.firstKickoff} /></> : 'first —'}</span>
                        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{p.lastKickoff ? <>last <Kickoff iso={p.lastKickoff} /></> : 'last —'}</span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ═══ CURRENT FORM — recent form + descriptive features + venue-split fixtures ════════
//
// One "how is this team doing recently?" surface, grouped as requested: the W/D/L
// sequence, the persisted descriptive performance features (context, not governed),
// and the recent home / away fixtures split by venue (GF/GA + result per match). All
// values are read verbatim; scores are team-relative via lineGoals (never re-oriented).

function VenueFormTable({ title, lines, teamName }: { title: string; lines: readonly TeamFixtureLine[]; teamName: string }) {
  return (
    <div className="space-y-1">
      <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{title}</p>
      {lines.length === 0 ? (
        <EmptyState message="None recorded." />
      ) : (
        <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Competition</th><th style={th}>Opponent</th><th style={th}>Res</th><th style={th}>GF</th><th style={th}>GA</th></tr></thead>
            <tbody>
              {lines.map((l) => {
                const { gf, ga } = lineGoals(l);
                return (
                  <tr key={l.fixtureId}>
                    <td style={td}><Kickoff iso={l.kickoffAt} /></td>
                    {/* Competition surfaced verbatim from the fixture line — recent form spans all
                        competitions, so each row states which one. Nothing derived or transformed. */}
                    <td style={{ ...td, whiteSpace: 'normal', color: 'var(--text-secondary)' }}>{l.competition.name}</td>
                    <td style={{ ...td, whiteSpace: 'normal' }}>
                      <Link href={routes.match(lineMatchFixture(l, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{l.opponent.name}</Link>
                    </td>
                    <td style={td}><FormLetter res={lineResult(l)} /></td>
                    <td style={td}>{orDash(gf)}</td><td style={td}>{orDash(ga)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Current form = FORM EVIDENCE only (the W/D/L sequence + the recent home/away match
// tables). The descriptive signal metrics (home/away form, momentum, goal-margin
// volatility, vs-stronger-opponents) are NOT repeated here: they are the Overview
// briefing's canonical summary, and goal-margin volatility is the Consistency reading
// shown below on this same tab. Keeping them here too was triple-counting the same values.
export function TeamCurrentForm({ recent, home, away, teamName }: {
  recent: readonly TeamFixtureLine[];
  home: readonly TeamFixtureLine[];
  away: readonly TeamFixtureLine[];
  teamName: string;
}) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Current form" count={recent.length} />
      {recent.length === 0 ? (
        <EmptyState message="No completed matches yet." />
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="recent result sequence">
            {recent.map((l) => <FormLetter key={l.fixtureId} res={lineResult(l)} />)}
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Recent form spans all competitions. Recent home/away fixtures — supporting evidence, not a home/away calculation.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <VenueFormTable title="Recent home matches" lines={home} teamName={teamName} />
            <VenueFormTable title="Recent away matches" lines={away} teamName={teamName} />
          </div>
        </>
      )}
    </section>
  );
}

// ═══ TEAM INTELLIGENCE BRIEFING — the Overview lead card (current picture + signals) ══
//
// The intelligence-first headline: a plain-language current-picture line taken from the
// backend's OWN interpretation (the readiness verdict text — never AI prose), then the key
// signals as value + unit + window + reliability. Labels are user-facing (no "Giant Killer",
// no backend terms). NOTHING is computed here: values, units, samples and the narrative are
// rendered exactly as the API returned them. A below-threshold sample is flagged "limited
// sample"; a momentum sign shows a direction cue (it is inherently a signed trend), but no
// arrow/trend is invented for the unsigned index metrics.

interface SignalSpec { readonly label: string; readonly pick: (o: TeamPerformanceOverall) => PerformanceMetric | null; readonly signed?: boolean }
const INTEL_SIGNALS: readonly SignalSpec[] = [
  { label: 'Home form', pick: (o) => o.homeForm },
  { label: 'Away form', pick: (o) => o.awayForm },
  { label: 'Momentum', pick: (o) => o.momentum, signed: true },
  { label: 'Goal-margin volatility', pick: (o) => o.goalMarginVolatility },
  { label: 'Vs stronger opponents', pick: (o) => o.giantKillerPpg },
];

function SignalCell({ label, metric, signed }: { label: string; metric: PerformanceMetric | null; signed?: boolean }) {
  if (!metric) {
    return (
      <div className="panel-raised" style={{ padding: 10, borderRadius: 6 }}>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
        <p style={{ color: 'var(--faint)', fontSize: 13, marginTop: 4 }}>Not enough data</p>
      </div>
    );
  }
  const dir = signed ? (metric.value > 0 ? { s: '▲', c: 'var(--edge)' } : metric.value < 0 ? { s: '▼', c: 'var(--risk)' } : { s: '·', c: 'var(--muted)' }) : null;
  return (
    <div className="panel-raised" style={{ padding: 10, borderRadius: 6 }}>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
      <p style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>{orDash(metric.value)}</span>
        {dir ? <span className="mono" style={{ color: dir.c, fontSize: 13 }} aria-hidden>{dir.s}</span> : null}
      </p>
      <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>
        {metric.unit} · last {metric.sample.matches} matches
      </p>
      {!metric.sample.meetsThreshold ? <p className="label-cap" style={{ color: 'var(--warn)', fontSize: 9 }}>limited sample</p> : null}
    </div>
  );
}

export function TeamIntelligenceBriefing({ teamName, overall, readiness, coverage }: {
  teamName: string;
  overall: TeamPerformanceOverall;
  readiness: TeamReadinessReading | null;
  coverage: 'present' | 'partial' | 'absent';
}) {
  const asOf = INTEL_SIGNALS.map((s) => s.pick(overall)).find((m) => m)?.asOf ?? null;
  return (
    <section className="space-y-2">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <p className="eyebrow">Team intelligence</p>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Key signals for {teamName}</span>
        {asOf ? <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginLeft: 'auto' }}>as of <Kickoff iso={asOf} /></span> : null}
      </div>
      {coverage === 'absent' && !readiness ? (
        <EmptyState message="Current-form signals are not available for this team yet." />
      ) : (
        <div className="panel" style={{ padding: 14 }}>
          {/* Current picture — the backend's own interpretation, verbatim (never invented) */}
          {readiness?.verdictText ? (
            <div style={{ marginBottom: 12 }}>
              <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Current picture</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 3 }}>{readiness.verdictText}</p>
              <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 3 }}>
                Based on {readiness.sample.matches} matches{readiness.sample.meetsThreshold ? '' : ' · limited sample'} · updated <Kickoff iso={readiness.asOf} />
              </p>
            </div>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
            {INTEL_SIGNALS.map((s) => <SignalCell key={s.label} label={s.label} metric={s.pick(overall)} signed={s.signed} />)}
          </div>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 10 }}>
            These signals span all competitions. Form and momentum are descriptive indicators over the stated window — not a prediction. Each signal shows its own sample size.
          </p>
        </div>
      )}
    </section>
  );
}

// ═══ READINESS — the GOVERNED reading (intelligence), kept separate from evidence ════

export function TeamReadinessPanel({ readiness, coverage }: {
  readiness: TeamReadinessReading | null;
  coverage: { readiness: 'present' | 'absent'; readinessIsGoverned: true };
}) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Team readiness" kind="governed" />
      {coverage.readiness === 'absent' || !readiness ? (
        <EmptyState message="No governed readiness reading available." />
      ) : (
        <>
          <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Status</span>
              <span className="mono" style={{ color: 'var(--text)', fontWeight: 700 }}>{readiness.status}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Strength</span>
              <span className="mono tnum" style={{ color: 'var(--text)' }}>{orDash(readiness.strength)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Confidence</span>
              <span className="mono tnum" style={{ color: 'var(--text)' }}>{orDash(readiness.confidence)}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Sample</span>
              <span className="mono tnum" style={{ color: 'var(--text)' }}>{readiness.sample.matches}{readiness.sample.meetsThreshold ? '' : ' ·below thresh'}</span>
            </div>
          </div>
          {readiness.verdictText && <p style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{readiness.verdictText}</p>}
          {readiness.inactiveReason && <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>Inactive: {readiness.inactiveReason}</p>}
          <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>as of <Kickoff iso={readiness.asOf} /></p>
          {readiness.evidence && (
            <div className="space-y-1">
              <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Supporting evidence</p>
              <EvidencePanel evidence={readiness.evidence} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ═══ GOVERNED INTELLIGENCE — home_away_split + consistency_index readings ════════════
//
// These render the GOVERNED module reading directly (status + verdict + sample + scope +
// as-of), exactly as persisted. Nothing is computed here: no home-minus-away win-rate,
// no volatility, no 0–100 score. Kept visually distinct (governed tag) from the
// descriptive home/away form and goal-margin volatility shown in Current Form.

function govStatusColor(status: string): string {
  const s = status.toUpperCase();
  if (s === 'SUPPORTS') return 'var(--edge)';
  if (s === 'CONTRADICTS') return 'var(--risk)';
  if (s === 'INACTIVE') return 'var(--faint)';
  return 'var(--muted)'; // NEUTRAL / MEASURED → engaged but quiet
}
function govScopeLabel(kind: string): string {
  return kind === 'COMPETITION_SCOPED' ? 'Competition scoped' : kind === 'ALL_COMPETITIONS' ? 'All competitions' : kind;
}

function GovernedReadingCard({ reading, magnitude }: { reading: TeamGovernedReading; magnitude?: { label: string; hint: string } }) {
  const inactive = reading.status.toUpperCase() === 'INACTIVE';
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontWeight: 700, color: govStatusColor(reading.status) }}>{reading.status}</span>
        {magnitude && reading.strength !== null && !inactive && (
          <>
            <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 18, fontWeight: 700 }}>{reading.strength}</span>
            <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{magnitude.label}</span>
          </>
        )}
      </div>
      {inactive
        ? (reading.inactiveReason && <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 4 }}>Inactive: {reading.inactiveReason}</p>)
        : (reading.verdictText && <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 4 }}>{reading.verdictText}</p>)}
      {magnitude && !inactive && <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 2 }}>{magnitude.hint}</p>}
      <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, marginTop: 6 }}>
        n={reading.sample.matches}{reading.sample.meetsThreshold ? '' : ' ·below thresh'} · {govScopeLabel(reading.scope.kind)} · as of <Kickoff iso={reading.asOf} />
      </p>
    </div>
  );
}

export function TeamHomeAwaySplitPanel({ readings }: { readings: readonly TeamGovernedReading[] }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Home / Away Split" kind="governed" count={readings.length || undefined} />
      {readings.length === 0 ? (
        <EmptyState message="No governed home/away split reading available." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {readings.map((r) => <GovernedReadingCard key={r.scope.competitionEditionId ?? r.moduleKey} reading={r} />)}
        </div>
      )}
    </section>
  );
}

export function TeamConsistencyPanel({ reading }: { reading: TeamGovernedReading | null }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Consistency Index" kind="governed" />
      {!reading ? (
        <EmptyState message="No governed consistency reading available." />
      ) : (
        <GovernedReadingCard reading={reading} magnitude={{ label: 'goal-margin volatility', hint: 'Higher volatility = less consistent' }} />
      )}
    </section>
  );
}

// ═══ STATISTICAL PROFILE — stat-tier Team Attributes (descriptive, edition-scoped) ═══
//
// Renders the backend `statistical` block VERBATIM: where the team sits within its
// edition on a small curated set of match statistics, classified into strengths,
// weaknesses and neutral style tendencies. Nothing is computed, ranked or predicted
// here; product-facing language only (no "benchmark"/"quartile"/"orientation" jargon,
// no probability/verdict). Below the sample floor → an honest empty state, never zero-fill.

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function StatAttributeRow({ attr }: { attr: StatisticalAttribute }) {
  // Product-facing position word — TOP/BOTTOM read as high/low for neutral tendencies.
  const position = attr.type === 'strength' ? 'Top quarter'
    : attr.type === 'weakness' ? 'Bottom quarter'
    : attr.level === 'TOP_QUARTILE' ? 'High' : 'Low';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
      <span style={{ color: 'var(--text)', fontSize: 13 }}>{attr.label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>{position}</span>
        <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700 }}>{orDash(attr.evidence.signalValue)}</span>
        <span className="mono tnum" style={{ color: 'var(--faint)', fontSize: 10 }}>{ordinal(attr.evidence.benchmark.rank)} of {attr.evidence.benchmark.teams}</span>
      </span>
    </div>
  );
}

export function TeamStatisticalAttributes({ block }: { block: StatisticalAttributesBlock | null }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Statistical profile" />
      {block === null ? (
        <EmptyState message="No statistical profile available for this team yet." />
      ) : block.insufficientSample ? (
        <EmptyState message={`Not enough completed matches yet for a statistical profile (needs ${block.sample.classificationFloor}, has ${block.sample.completedFixtures}).`} />
      ) : (block.strengths.length + block.weaknesses.length + block.tendencies.length === 0) ? (
        <EmptyState message="This team sits mid-table on every profiled statistic — no standout strengths or weaknesses." />
      ) : (
        <div className="space-y-3">
          {block.strengths.length > 0 && (
            <div>
              <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginBottom: 2 }}>Strengths</p>
              {block.strengths.map((a) => <StatAttributeRow key={a.key} attr={a} />)}
            </div>
          )}
          {block.weaknesses.length > 0 && (
            <div>
              <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginBottom: 2 }}>Weaknesses</p>
              {block.weaknesses.map((a) => <StatAttributeRow key={a.key} attr={a} />)}
            </div>
          )}
          {block.tendencies.length > 0 && (
            <div>
              <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginBottom: 2 }}>Style tendencies</p>
              {block.tendencies.map((a) => <StatAttributeRow key={a.key} attr={a} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ═══ SEASON STATISTICS — descriptive backend-derived aggregates (context) ════════════
//
// Renders the backend-provided per-key season aggregates from
// intelligence.playerStatistics.statisticKeys VERBATIM. `numericTotal` is the backend SUM
// over every (player, match) observation this team recorded this season — a genuine season
// team total for additive counting stats — with `fixtures`/`players` as observed coverage.
// NOTHING is computed here: no per-90, no percentages, no accuracy/conversion, no averaging,
// no ranking, no score. `numericMean` is intentionally NOT surfaced: its denominator (the
// player-match observation count) is not in the wire contract, so it cannot be shown beside
// fixtures/players without inviting a false division (documented as a deferred item).
//
// Non-numeric (JSON) provider keys carry a null total and are excluded (they are provider
// metadata, not athlete-facing stats). Only a curated, grouped set of established football
// statistics is surfaced — never a raw provider-key dump — and only keys the backend
// actually supplied with a numeric total appear. Additive counting stats only; instantaneous
// stats whose SUM is meaningless (e.g. top speed) are deliberately not catalogued.

interface StatSpec { readonly key: string; readonly label: string }
interface StatGroup { readonly title: string; readonly specs: readonly StatSpec[] }

const SEASON_STAT_GROUPS: readonly StatGroup[] = [
  { title: 'Attacking', specs: [
    { key: 'goals', label: 'Goals' },
    { key: 'expectedGoals', label: 'xG' },
    { key: 'expectedGoalsOnTarget', label: 'xG on target' },
    { key: 'totalShots', label: 'Shots' },
    { key: 'onTargetScoringAttempt', label: 'Shots on target' },
    { key: 'goalAssist', label: 'Assists' },
    { key: 'expectedAssists', label: 'xA' },
    { key: 'bigChanceCreated', label: 'Big chances created' },
    { key: 'bigChanceMissed', label: 'Big chances missed' },
    { key: 'hitWoodwork', label: 'Woodwork hits' },
  ] },
  { title: 'Passing & distribution', specs: [
    { key: 'accuratePass', label: 'Accurate passes' },
    { key: 'totalPass', label: 'Total passes' },
    { key: 'keyPass', label: 'Key passes' },
    { key: 'accurateLongBalls', label: 'Accurate long balls' },
    { key: 'totalLongBalls', label: 'Total long balls' },
    { key: 'accurateCross', label: 'Accurate crosses' },
    { key: 'totalCross', label: 'Total crosses' },
  ] },
  { title: 'Progression & possession', specs: [
    { key: 'touches', label: 'Touches' },
    { key: 'ballCarriesCount', label: 'Ball carries' },
    { key: 'progressiveBallCarriesCount', label: 'Progressive ball carries' },
    { key: 'possessionLostCtrl', label: 'Possession lost' },
  ] },
  { title: 'Defending & duels', specs: [
    { key: 'duelWon', label: 'Duels won' },
    { key: 'duelLost', label: 'Duels lost' },
    { key: 'totalTackle', label: 'Tackles' },
    { key: 'wonTackle', label: 'Tackles won' },
    { key: 'interceptionWon', label: 'Interceptions' },
    { key: 'totalClearance', label: 'Clearances' },
    { key: 'aerialWon', label: 'Aerials won' },
    { key: 'aerialLost', label: 'Aerials lost' },
    { key: 'outfielderBlock', label: 'Blocks' },
  ] },
  { title: 'Physical output', specs: [
    { key: 'kilometersCovered', label: 'Distance covered (km)' },
    { key: 'metersCoveredHighSpeedRunningKm', label: 'High-speed running (km)' },
    { key: 'metersCoveredSprintingKm', label: 'Sprint distance (km)' },
    { key: 'numberOfSprints', label: 'Sprints' },
  ] },
  { title: 'Goalkeeping', specs: [
    { key: 'saves', label: 'Saves' },
    { key: 'savedShotsFromInsideTheBox', label: 'Saves inside box' },
    { key: 'goalsPrevented', label: 'Goals prevented' },
    { key: 'punches', label: 'Punches' },
  ] },
];

type StatRow = TeamIntelligence['playerStatistics']['statisticKeys'][number];

export function TeamSeasonStatistics({ playerStatistics }: { playerStatistics: TeamIntelligence['playerStatistics'] }) {
  const byKey = new Map(playerStatistics.statisticKeys.map((k) => [k.statisticKey, k]));
  // A metric renders only when the backend supplied that curated key WITH a numeric total.
  // Non-numeric/JSON provider keys carry a null total and drop out here (never zero-filled).
  const groups = SEASON_STAT_GROUPS
    .map((g) => ({
      title: g.title,
      metrics: g.specs
        .map((spec) => ({ spec, row: byKey.get(spec.key) }))
        .filter((m): m is { spec: StatSpec; row: StatRow } => !!m.row && m.row.numericTotal !== null),
    }))
    .filter((g) => g.metrics.length > 0);
  const shown = groups.reduce((n, g) => n + g.metrics.length, 0);

  return (
    <section className="space-y-2">
      <Eyebrow label="Season statistics" count={shown || undefined} />
      {groups.length === 0 ? (
        <EmptyState message="No season statistics recorded yet." />
      ) : (
        <>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
            Season totals span all competitions. Descriptive · derived aggregates — backend season totals summed across every recorded player-match observation; fx = fixtures observed, pl = players observed. Not an intelligence rating, ranking or score.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.map((g) => (
              <div key={g.title} className="space-y-1">
                <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{g.title}</p>
                <div className="panel" style={{ padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                  {g.metrics.map(({ spec, row }) => (
                    <div key={spec.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{spec.label}</span>
                      <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 15, fontWeight: 700 }}>{row.numericTotal}</span>
                      <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{row.fixtures} fx · {row.players} pl</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ═══ SQUAD SNAPSHOT + AVAILABILITY — the honest tri-state headline + injuries board ══
//
// Snapshot is a TRI-STATE count, never a binary: Registered (roster size), Unavailable
// (registered players with a CURRENT unavailability record) and Unknown (the remainder).
// The remainder is NEVER labelled "available": absence of an unavailability record is not
// confirmation a player is fit, rested or selected. The board renders each current record
// verbatim (kind, reason, from, expected return) — no invented medical detail, importance,
// role, replacement or impact. Registered = Unavailable + Unknown exactly.

export function TeamSquadSnapshot({ squad, availability }: {
  squad: TeamIntelligence['squad'];
  availability: readonly TeamAvailabilityRecord[];
}) {
  const registered = squad.length;
  const squadIds = new Set(squad.map((p) => p.playerId));
  // Distinct registered players with a CURRENT unavailability record. Intersecting with the
  // squad keeps the remainder ("unknown") non-negative — a plain count, no football math.
  const unavailable = new Set(
    availability.filter((a) => a.current && squadIds.has(a.playerId)).map((a) => a.playerId),
  ).size;
  const unknown = registered - unavailable;
  const cells: readonly { readonly label: string; readonly value: number; readonly color: string }[] = [
    { label: 'Registered', value: registered, color: 'var(--text)' },
    { label: 'Unavailable', value: unavailable, color: unavailable > 0 ? 'var(--risk)' : 'var(--muted)' },
    { label: 'Unknown', value: unknown, color: 'var(--muted)' },
  ];
  return (
    <section className="space-y-2">
      <Eyebrow label="Squad snapshot" />
      <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {cells.map((c) => (
          <div key={c.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="mono tnum" style={{ color: c.color, fontSize: 22, fontWeight: 700 }}>{c.value}</span>
            <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{c.label}</span>
          </div>
        ))}
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Unknown = registered players with no current unavailability record — not confirmed available, fit, rested or selected.
      </p>
    </section>
  );
}

// Prominent availability / injuries board: each CURRENT unavailability record rendered
// verbatim. No current record → an honest empty line, never a positive "all available"
// conclusion. Player names are plain text (the availability payload carries no slug).
export function TeamAvailabilityBoard({ availability }: {
  availability: readonly TeamAvailabilityRecord[];
}) {
  const current = availability.filter((a) => a.current);
  return (
    <section className="space-y-2">
      <Eyebrow label="Availability & injuries" count={current.length || undefined} />
      {current.length === 0 ? (
        <EmptyState message="No current unavailability records." />
      ) : (
        <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px 16px' }}>
          {current.map((rec) => (
            <div key={`${rec.playerId}-${rec.from ?? ''}`} style={{ display: 'flex', flexDirection: 'column', gap: 1, borderLeft: '2px solid var(--risk)', paddingLeft: 8 }}>
              <span className="mono" style={{ color: 'var(--text)', fontWeight: 600 }}>{rec.fullName}</span>
              <AvailabilityDetail rec={rec} />
            </div>
          ))}
        </div>
      )}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Absence of a record is not confirmation a player is available, fit, rested or selected.
      </p>
    </section>
  );
}

// ═══ PLAYERS — squad roster: player + registration + valuation (context) ════════════
//
// The roster is Player / Registration / Value. Availability now lives in the dedicated
// board above (not duplicated here). Registration kind is shown human-readable for the
// known codes and verbatim otherwise (unknown kinds stay identifiable); from/to are
// null-honest — a null registrationTo is never "permanent" (only the kind code can say
// that). Valuation is joined by playerId only, verbatim, with no squad total or ranking.

// Human-readable registration kind. Only the authorized codes get a friendly label; every
// other code is shown verbatim so unknown kinds stay identifiable (never remapped to a
// made-up category).
const REGISTRATION_LABEL: Readonly<Record<string, string>> = {
  PERMANENT: 'Permanent',
  LOAN: 'Loan',
  TEMPORARY: 'Temporary',
};
function registrationLabel(code: string): string {
  return REGISTRATION_LABEL[code] ?? code;
}

function AvailabilityDetail({ rec }: { rec: TeamAvailabilityRecord }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ color: 'var(--risk)', fontWeight: 600 }}>{rec.unavailabilityKindCode}</span>
      {rec.reason ? <span style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{rec.reason}</span> : null}
      {rec.from ? <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>from {rec.from}</span> : null}
      {rec.expectedReturnOn ? <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>expected return {rec.expectedReturnOn}</span> : null}
    </div>
  );
}

// Per-player valuation, joined by playerId. Rendered VERBATIM in the established Player-page
// grammar: raw amount + provider currency code (no invented € symbol, no m/k rounding, no
// currency conversion) plus the record's own asOfOn date. sourceCode is NOT dumped per row.
function ValuationCell({ v }: { v: TeamIntelligence['valuations'][number] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span className="mono tnum" style={{ color: 'var(--text)' }}>{v.amount}{v.currencyCode ? ` ${v.currencyCode}` : ''}</span>
      <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>as of {v.asOfOn}</span>
    </div>
  );
}

export function TeamPlayers({ squad, valuations = [] }: {
  squad: TeamIntelligence['squad'];
  valuations?: TeamIntelligence['valuations'];
}) {
  // Join valuations to squad rows by playerId ONLY (never by name). No summing, averaging,
  // ranking or squad-total — each row shows its own player's provider valuation, or a dash.
  const valuationByPlayer = new Map(valuations.map((v) => [v.playerId, v]));
  return (
    <section className="space-y-2">
      <Eyebrow label="Squad" count={squad.length} />
      {squad.length === 0 ? (
        <EmptyState message="No squad registered yet." />
      ) : (
        <>
          <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
              <thead><tr><th style={th}>Player</th><th style={th}>Registration</th><th style={th}>Value</th></tr></thead>
              <tbody>
                {squad.map((p) => {
                  const valuation = valuationByPlayer.get(p.playerId);
                  return (
                    <tr key={p.playerId}>
                      <td style={{ ...td, whiteSpace: 'normal' }}>
                        <Link href={routes.player({ id: p.playerId, slug: p.slug })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.fullName}</Link>
                      </td>
                      <td style={{ ...td, whiteSpace: 'normal' }}>
                        <span className="mono" style={{ color: 'var(--text-secondary)' }}>{registrationLabel(p.registrationKindCode)}</span>
                        <span className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9, display: 'block' }}>
                          {orDash(p.registrationFrom)} → {orDash(p.registrationTo)}
                        </span>
                      </td>
                      <td style={{ ...td, whiteSpace: 'normal' }}>
                        {valuation ? <ValuationCell v={valuation} /> : <span className="label-cap" style={{ color: 'var(--faint)' }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
            Value = source-provided player valuation (descriptive), shown as of each record&apos;s date. Unvalued players show —, never a zero value. No squad total or ranking.
          </p>
        </>
      )}
    </section>
  );
}

// ═══ LAST APPEARANCE — compact reference to the team's most recent completed fixture ══
//
// A pointer, not a stat table: the most recent completed fixture that carries player
// statistics (playerPerformances.fixture), shown as fixture identity + team-relative
// score + a link to the Match page. Per-player minutes / rating / xG / xA and raw match
// statistics are NOT duplicated here — the Match page is their canonical home.

export function TeamLastAppearance({ playerPerformances, teamName }: {
  playerPerformances: TeamIntelligence['playerPerformances'];
  teamName: string;
}) {
  const fixture = playerPerformances.fixture;
  if (!fixture) {
    return (
      <section className="space-y-2">
        <Eyebrow label="Last appearance" />
        <EmptyState message="No completed match recorded yet." />
      </section>
    );
  }
  const { gf, ga } = lineGoals(fixture);
  const score = gf === null || ga === null ? '—' : `${gf}–${ga}`;
  return (
    <section className="space-y-2">
      <Eyebrow label="Last appearance" />
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span className="mono" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 14 }}>
              {teamName}{' '}<span className="tnum">{score}</span>{' '}{fixture.opponent.name}
            </span>
            <FormLetter res={lineResult(fixture)} />
          </span>
          <Link href={routes.match(lineMatchFixture(fixture, teamName))} className="label-cap" style={{ color: 'var(--cool)', textDecoration: 'none', fontSize: 10 }}>View match →</Link>
        </div>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 4 }}>
          {fixture.competition.name} · {fixture.isHome ? 'Home' : 'Away'} · <Kickoff iso={fixture.kickoffAt} />
        </p>
      </div>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Player minutes, ratings and detailed match statistics are on the match page.
      </p>
    </section>
  );
}

// ═══ FIXTURE TABLE — shared fixture-line table (Current Form + Upcoming) ═════════════
//
// showScore renders the team-relative Score (GF–GA) + Res (completed fixtures);
// showStatus renders the lifecycle status (meaningful for upcoming SCHEDULED/POSTPONED,
// redundant for recent COMPLETED so Current Form turns it off).

function FixtureTable({ lines, teamName, showScore, showStatus = true }: { lines: readonly TeamFixtureLine[]; teamName: string; showScore: boolean; showStatus?: boolean }) {
  return (
    <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
      <table className="tnum" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
        <thead><tr>
          <th style={th}>Date</th><th style={th}>Competition</th><th style={th}>Opponent</th><th style={th}>H/A</th>
          {showScore ? <><th style={th}>Score</th><th style={th}>Res</th></> : null}{showStatus ? <th style={th}>Status</th> : null}
        </tr></thead>
        <tbody>
          {lines.map((l) => {
            const { gf, ga } = lineGoals(l);
            return (
              <tr key={l.fixtureId}>
                <td style={td}><Kickoff iso={l.kickoffAt} /></td>
                <td style={{ ...td, whiteSpace: 'normal' }}>{l.competition.name}</td>
                <td style={{ ...td, whiteSpace: 'normal' }}>
                  <Link href={routes.match(lineMatchFixture(l, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{l.opponent.name}</Link>
                </td>
                <td style={td}>{l.isHome ? 'H' : 'A'}</td>
                {showScore ? <><td style={td}>{gf === null || ga === null ? '—' : `${gf}–${ga}`}</td><td style={td}><FormLetter res={lineResult(l)} /></td></> : null}
                {showStatus ? <td style={td}><span className="label-cap" style={{ color: 'var(--faint)' }}>{l.status}</span></td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══ NEXT-FIXTURE SELECTION PICTURE — descriptive availability summary (context) ═════
//
// A SUMMARY only (the full per-player availability picture stays in Squad above): the
// registered count, the players with an explicit CURRENT unavailability record for the
// next fixture, and how many registered players carry NO such record. That last figure
// is stated honestly — "N registered players have no current unavailability record",
// NOT "N available": no record ≠ available/fit/rested/selected.

function NextFixtureSelection({ nextFixture, teamName }: { nextFixture: NonNullable<TeamIntelligence['nextFixture']>; teamName: string }) {
  const f = nextFixture.fixture;
  const unknownCount = nextFixture.availabilityUnknown.length;
  return (
    <div className="space-y-2">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Next-fixture selection picture</p>
        <Tag kind="context" />
      </div>
      <div className="panel space-y-2" style={{ padding: 12 }}>
        <p className="label-cap" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
          <Link href={routes.match(lineMatchFixture(f, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{f.opponent.name}</Link>
          {' · '}{f.isHome ? 'Home' : 'Away'}{' · '}<Kickoff iso={f.kickoffAt} />
        </p>
        <p className="mono tnum" style={{ color: 'var(--text)' }}>{nextFixture.registeredCount} registered</p>

        <div className="space-y-1">
          <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Explicitly unavailable ({nextFixture.explicitlyUnavailable.length})</p>
          {nextFixture.explicitlyUnavailable.length === 0 ? (
            <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>No current unavailability records for this fixture.</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {nextFixture.explicitlyUnavailable.map((u) => (
                <li key={u.playerId} style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--risk)', fontWeight: 600 }}>{u.unavailabilityKindCode}</span>
                  {' · '}{u.fullName}
                  {u.reason ? <span style={{ color: 'var(--faint)' }}> · {u.reason}</span> : null}
                  {u.expectedReturnOn ? <span className="tnum" style={{ color: 'var(--faint)' }}> · expected return {u.expectedReturnOn}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="tnum" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
            {unknownCount} registered player{unknownCount === 1 ? '' : 's'} {unknownCount === 1 ? 'has' : 'have'} no current unavailability record
          </p>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
            Not confirmed available, fit, rested or selected — only that no unavailability is recorded.
          </p>
        </div>
      </div>
    </div>
  );
}

export function TeamUpcomingFixtures({ upcoming, teamName, nextFixture }: {
  upcoming: readonly TeamFixtureLine[];
  teamName: string;
  nextFixture?: TeamIntelligence['nextFixture'];
}) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Upcoming fixtures" count={upcoming.length} />
      {upcoming.length === 0 ? <EmptyState message="No upcoming fixtures scheduled." /> : <FixtureTable lines={upcoming} teamName={teamName} showScore={false} />}
      {nextFixture ? <NextFixtureSelection nextFixture={nextFixture} teamName={teamName} /> : null}
    </section>
  );
}

// ═══ NEXT FIXTURE & SELECTION — Overview consolidation (fixture + squad availability) ══
//
// Absorbs the separate Upcoming-fixture and Squad-summary cards on Overview into ONE
// surface: the next scheduled fixture, the registered count, the explicitly-unavailable
// players and the honest "no current record" count — with a link to the full Squad tab.
// Same honesty as the standalone selection picture: no record ≠ available, no fabricated
// return date, and no "context/governed" jargon on the label.

export function TeamNextFixtureAndSelection({ nextFixture, teamName, slug }: {
  nextFixture: TeamIntelligence['nextFixture'];
  teamName: string;
  slug: string;
}) {
  const unknown = nextFixture?.availabilityUnknown.length ?? 0;
  return (
    <section className="space-y-2">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <p className="eyebrow">Next fixture &amp; selection</p>
        <Link href={teamTabHref(slug, 'squad')} className="label-cap" style={{ color: 'var(--cool)', textDecoration: 'none', fontSize: 10 }}>View full squad →</Link>
      </div>
      {!nextFixture ? (
        <EmptyState message="No upcoming fixture scheduled." />
      ) : (
        <div className="panel space-y-2" style={{ padding: 14 }}>
          <p className="label-cap" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
            <Link href={routes.match(lineMatchFixture(nextFixture.fixture, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{nextFixture.fixture.opponent.name}</Link>
            {' · '}{nextFixture.fixture.isHome ? 'Home' : 'Away'}{' · '}{nextFixture.fixture.competition.name}{' · '}<Kickoff iso={nextFixture.fixture.kickoffAt} />
          </p>
          <p style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700 }}>{nextFixture.registeredCount}</span>
            <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>registered players</span>
          </p>
          <div className="space-y-1">
            <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Unavailable ({nextFixture.explicitlyUnavailable.length})</p>
            {nextFixture.explicitlyUnavailable.length === 0 ? (
              <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10 }}>No current unavailability records for this fixture.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {nextFixture.explicitlyUnavailable.map((u) => (
                  <li key={u.playerId} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--risk)', fontWeight: 600 }}>{u.unavailabilityKindCode}</span>
                    {' · '}{u.fullName}
                    {u.reason ? <span style={{ color: 'var(--faint)' }}> · {u.reason}</span> : null}
                    {u.expectedReturnOn ? <span className="tnum" style={{ color: 'var(--faint)' }}> · expected return {u.expectedReturnOn}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="tnum" style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
              {unknown} registered player{unknown === 1 ? '' : 's'} {unknown === 1 ? 'has' : 'have'} no current unavailability record
            </p>
            <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
              Not confirmed available, fit, rested or selected — only that no unavailability is recorded.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

// ═══ DATA COVERAGE — which data domains this team's feed supports (transparency) ══════
//
// A single primary home for the coverage matrix (never repeated in Season Statistics,
// Squad, Last Match or Upcoming). Renders intelligence.coverage VERBATIM: each domain's
// state as the backend supplies it (present / absent / partial / not-supported), plus the
// derived-aggregate disclosure. NOTHING is computed — no data-quality score, no percentage,
// no universal freshness timestamp. "not supported" describes THIS feed, never the world.

type CoverageDomainKey = Exclude<keyof TeamIntelligence['coverage'], 'statisticsAreDerivedAggregates'>;

const COVERAGE_ROWS: readonly { readonly key: CoverageDomainKey; readonly label: string }[] = [
  { key: 'registrations', label: 'Registrations' },
  { key: 'availability', label: 'Availability' },
  { key: 'valuations', label: 'Valuations' },
  { key: 'playerMatchStatistics', label: 'Player statistics' },
  { key: 'appearances', label: 'Appearances' },
  { key: 'perPlayerCards', label: 'Player cards' },
  { key: 'standings', label: 'Standings' },
  { key: 'managerReferee', label: 'Manager / Referee' },
];

function CoverageLabel({ state }: { state: string }) {
  const map: Record<string, { text: string; color: string }> = {
    'present': { text: 'PRESENT', color: 'var(--edge)' },
    'partial': { text: 'PARTIAL', color: 'var(--warn)' },
    'absent': { text: 'ABSENT', color: 'var(--muted)' },
    'not-supported': { text: 'NOT SUPPORTED', color: 'var(--faint)' },
  };
  const m = map[state] ?? { text: state.toUpperCase(), color: 'var(--muted)' };
  return <span className="mono" style={{ color: m.color, fontSize: 10, fontWeight: 700 }}>{m.text}</span>;
}

export function TeamCoverage({ coverage }: { coverage: TeamIntelligence['coverage'] }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Data coverage" />
      <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '4px 16px' }}>
        {COVERAGE_ROWS.map((r) => (
          <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, borderBottom: '1px solid var(--line)', padding: '2px 0' }}>
            <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>{r.label}</span>
            <CoverageLabel state={coverage[r.key]} />
          </div>
        ))}
      </div>
      {coverage.statisticsAreDerivedAggregates ? (
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Player statistics shown here are backend-derived aggregates.</p>
      ) : null}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Coverage describes this team&apos;s current data feed; NOT SUPPORTED means the feed does not provide it, not that it does not exist.
      </p>
    </section>
  );
}

// ═══ TAB NAVIGATION — horizontal, below the identity header (no sidebar) ══════════════

export function TeamTabNav({ slug, active }: { slug: string; active: TeamTab }) {
  return (
    <nav aria-label="team sections" style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', overflowX: 'auto' }}>
      {TEAM_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link key={t.key} href={teamTabHref(slug, t.key)} aria-current={isActive ? 'page' : undefined}
            className="label-cap" style={{
              padding: '8px 12px', textDecoration: 'none', whiteSpace: 'nowrap',
              color: isActive ? 'var(--text)' : 'var(--muted)',
              borderBottom: `2px solid ${isActive ? 'var(--amber)' : 'transparent'}`,
              marginBottom: -1,
            }}>{t.label}</Link>
        );
      })}
    </nav>
  );
}

// ═══ RECENT FIXTURES — completed results list (Fixtures tab) ══════════════════════════

export function TeamRecentFixtures({ recent, teamName }: { recent: readonly TeamFixtureLine[]; teamName: string }) {
  return (
    <section className="space-y-2">
      <Eyebrow label="Recent results" count={recent.length} />
      {recent.length === 0 ? <EmptyState message="No completed fixtures recorded." /> : <FixtureTable lines={recent} teamName={teamName} showScore showStatus={false} />}
    </section>
  );
}

// ═══ SQUAD SUMMARY — compact Overview preview (counts + current unavailable + link) ═══
//
// Overview gets a SUMMARY, not the full roster (that lives in the Squad tab). No value
// ranking, no squad-value total, no fabricated positions — just the registered count, the
// current availability picture (which is genuinely useful pre-fixture context), and a link.

export function TeamSquadSummary({ squad, availability, slug }: {
  squad: TeamIntelligence['squad'];
  availability: readonly TeamAvailabilityRecord[];
  slug: string;
}) {
  const unavailable = availability.filter((a) => a.current);
  return (
    <section className="space-y-2">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Eyebrow label="Squad" />
        <Link href={teamTabHref(slug, 'squad')} className="label-cap" style={{ color: 'var(--cool)', textDecoration: 'none', fontSize: 10 }}>View full squad →</Link>
      </div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700 }}>{squad.length}</span>
          <span className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>registered players</span>
        </div>
        <div style={{ marginTop: 10 }}>
          <p className="label-cap" style={{ color: 'var(--muted)', fontSize: 10 }}>Current unavailability ({unavailable.length})</p>
          {unavailable.length === 0 ? (
            <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginTop: 2 }}>No current unavailability records.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {unavailable.map((a) => (
                <li key={a.playerId} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--risk)', fontWeight: 600 }}>{a.unavailabilityKindCode}</span>
                  {' · '}{a.fullName}
                  {a.reason ? <span style={{ color: 'var(--faint)' }}> · {a.reason}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ═══ RESULT ATTRIBUTES — result-tier team attributes (Overview) ═══════════════════════
//
// The top-level result-based attributes (goals per match, clean-sheet rate, …): where the
// team ranks within its edition, classified into strengths / tendencies / weaknesses. Each
// row is label · value · rank n/N · league median · level, all VERBATIM from the payload.
// The "better" orientation comes from qualityOrientation (governed) — the UI never assumes
// it. Nothing is computed, ranked or predicted here.

function orientationHint(q: string): string | null {
  return q === 'HIGHER_IS_BETTER' ? 'higher is better' : q === 'LOWER_IS_BETTER' ? 'lower is better' : null;
}
function levelWord(level: string, type: string): string {
  if (type === 'strength') return 'Top quarter';
  if (type === 'weakness') return 'Bottom quarter';
  return level === 'TOP_QUARTILE' ? 'High' : level === 'BOTTOM_QUARTILE' ? 'Low' : 'Mid';
}
function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function ResultAttributeRow({ attr }: { attr: ResultAttribute }) {
  const hint = orientationHint(attr.qualityOrientation);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2px 12px', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ color: 'var(--text)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{attr.label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
        <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 13, fontWeight: 700 }}>{fmtNum(attr.evidence.signalValue)}</span>
        <span className="mono tnum" style={{ color: 'var(--faint)', fontSize: 10 }}>{ordinal(attr.evidence.benchmark.rank)} of {attr.evidence.benchmark.teams}</span>
        <span className="mono tnum hidden sm:inline" style={{ color: 'var(--faint)', fontSize: 10 }}>med {fmtNum(attr.evidence.benchmark.median)}</span>
        <span className="label-cap hidden sm:inline" style={{ color: 'var(--muted)', fontSize: 9 }}>{levelWord(attr.level, attr.type)}</span>
      </span>
      {hint && <span className="label-cap" style={{ gridColumn: '1 / -1', color: 'var(--faint)', fontSize: 9 }}>{hint}</span>}
    </div>
  );
}

export function TeamResultAttributes({ strengths = [], weaknesses = [], tendencies = [], insufficientSample = false }: {
  strengths?: readonly ResultAttribute[];
  weaknesses?: readonly ResultAttribute[];
  tendencies?: readonly ResultAttribute[];
  insufficientSample?: boolean;
}) {
  const total = strengths.length + weaknesses.length + tendencies.length;
  return (
    <section className="space-y-2">
      <Eyebrow label="Team attributes" count={total || undefined} />
      {insufficientSample ? (
        <EmptyState message="Not enough completed matches yet for a team attributes profile." />
      ) : total === 0 ? (
        <EmptyState message="This team sits mid-table on every profiled result metric — no standout strengths or weaknesses." />
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          {strengths.length > 0 && (
            <div style={{ marginBottom: tendencies.length || weaknesses.length ? 10 : 0 }}>
              <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginBottom: 2 }}>Strengths</p>
              {strengths.map((a) => <ResultAttributeRow key={a.key} attr={a} />)}
            </div>
          )}
          {tendencies.length > 0 && (
            <div style={{ marginBottom: weaknesses.length ? 10 : 0 }}>
              <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginBottom: 2 }}>Style tendencies</p>
              {tendencies.map((a) => <ResultAttributeRow key={a.key} attr={a} />)}
            </div>
          )}
          {weaknesses.length > 0 && (
            <div>
              <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 10, marginBottom: 2 }}>Weaknesses</p>
              {weaknesses.map((a) => <ResultAttributeRow key={a.key} attr={a} />)}
            </div>
          )}
        </div>
      )}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
        Where this team ranks within its edition on completed matches to date. Rank and median are read verbatim; nothing is predicted.
      </p>
    </section>
  );
}

// ═══ RECENT RESULTS — compact last-N results (Overview) ═══════════════════════════════

export function TeamRecentResults({ recent, teamName, limit = 5 }: { recent: readonly TeamFixtureLine[]; teamName: string; limit?: number }) {
  const lines = recent.slice(0, limit);
  return (
    <section className="space-y-2">
      <Eyebrow label="Recent results" count={recent.length || undefined} />
      {lines.length === 0 ? (
        <EmptyState message="No completed matches yet." />
      ) : (
        <div className="panel" style={{ padding: 8 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lines.map((l) => {
              const { gf, ga } = lineGoals(l);
              return (
                <li key={l.fixtureId} style={{ display: 'grid', gridTemplateColumns: '18px minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '6px 6px', borderBottom: '1px solid var(--line)' }}>
                  <FormLetter res={lineResult(l)} />
                  <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                    <Link href={routes.match(lineMatchFixture(l, teamName))} style={{ color: 'var(--cool)', textDecoration: 'none', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {l.isHome ? 'v ' : '@ '}{l.opponent.name}
                    </Link>
                    <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{l.competition.name}</span>
                  </span>
                  <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600 }}>{gf === null || ga === null ? '—' : `${gf}–${ga}`}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>Across all competitions. The full home/away split is on the Performance tab.</p>
    </section>
  );
}

// ═══ SQUAD ROSTER — registered players joined with observations + valuations (Squad) ══
//
// The registered squad joined by playerId with per-player observations (started / bench /
// minutes / goals) and the source valuation, plus an availability chip. Sorted by minutes
// (desc), then name. Positions, shirt numbers, ages and nationality are not supplied and
// are not shown. A collapsed list surfaces players who appeared this season but are not in
// the registered squad. Every unrecorded value is an em dash — never a fabricated zero.

function summaryTotal(p: TeamPlayerObservation | undefined, key: string): number | null {
  if (!p) return null;
  const s = p.summary.find((x) => x.key === key);
  return s && s.present > 0 ? s.total : null;
}

function AvailabilityChip({ rec }: { rec: TeamAvailabilityRecord | undefined }) {
  if (!rec) return <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>—</span>;
  return (
    <span className="label-cap" title={rec.reason ?? rec.unavailabilityKindCode} style={{ color: 'var(--risk)', border: '1px solid var(--risk)', borderRadius: 4, padding: '0 5px', fontSize: 9, whiteSpace: 'nowrap' }}>
      ▲ {rec.unavailabilityKindCode}
    </span>
  );
}

export function TeamSquadRoster({ squad, playerObservations = [], valuations = [], availability = [] }: {
  squad: TeamIntelligence['squad'];
  playerObservations?: readonly TeamPlayerObservation[];
  valuations?: TeamIntelligence['valuations'];
  availability?: readonly TeamAvailabilityRecord[];
}) {
  const obsById = new Map(playerObservations.map((p) => [p.player.id, p]));
  const valById = new Map(valuations.map((v) => [v.playerId, v]));
  const availById = new Map(availability.filter((a) => a.current).map((a) => [a.playerId, a]));

  const rows = squad
    .map((p) => {
      const obs = obsById.get(p.playerId);
      return { p, obs, minutes: summaryTotal(obs, 'minutesPlayed'), goals: summaryTotal(obs, 'goals') };
    })
    .sort((a, b) => (b.minutes ?? -1) - (a.minutes ?? -1) || a.p.fullName.localeCompare(b.p.fullName));

  // Players who appeared this season but are not in the registered squad.
  const squadIds = new Set(squad.map((p) => p.playerId));
  const alsoAppeared = playerObservations.filter((p) => !squadIds.has(p.player.id));

  return (
    <section className="space-y-2">
      <Eyebrow label="Squad" count={squad.length} />
      {squad.length === 0 ? (
        <EmptyState message="No squad registered yet." />
      ) : (
        <>
          <div className="panel" style={{ padding: 8, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, minWidth: 520 }}>
              <caption className="sr-only">Registered squad, sorted by minutes played.</caption>
              <thead><tr>
                <th style={{ ...th }}>Player</th>
                <th style={{ ...th }}>Availability</th>
                <th style={{ ...th, textAlign: 'right' }}>Started</th>
                <th style={{ ...th, textAlign: 'right' }}>Bench</th>
                <th style={{ ...th, textAlign: 'right' }}>Minutes</th>
                <th style={{ ...th, textAlign: 'right' }}>Goals</th>
                <th style={{ ...th, textAlign: 'right' }}>Value</th>
              </tr></thead>
              <tbody>
                {rows.map(({ p, obs, minutes, goals }) => {
                  const v = valById.get(p.playerId);
                  return (
                    <tr key={p.playerId}>
                      <td style={{ ...td, whiteSpace: 'normal' }}>
                        <Link href={routes.player({ id: p.playerId, slug: p.slug })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.fullName}</Link>
                        <span className="label-cap" style={{ color: 'var(--faint)', fontSize: 9, display: 'block' }}>{registrationLabel(p.registrationKindCode)}</span>
                      </td>
                      <td style={td}><AvailabilityChip rec={availById.get(p.playerId)} /></td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{obs ? obs.participation.started : '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{obs ? obs.participation.bench : '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{minutes ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{goals ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right' }} className="tnum">{v ? `${v.amount}${v.currencyCode ? ` ${v.currencyCode}` : ''}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
            Sorted by minutes. Positions, shirt numbers, ages and nationality are not supplied by the feed and are not shown. Unrecorded values show —, never a zero. Value is a source-provided valuation.
          </p>
          {alsoAppeared.length > 0 && (
            <details className="panel" style={{ padding: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12 }}>
                Also appeared this season, not currently registered · {alsoAppeared.length}
              </summary>
              <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {alsoAppeared.map((p) => {
                  const minutes = summaryTotal(p, 'minutesPlayed');
                  return (
                    <li key={p.player.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
                      <Link href={routes.player({ id: p.player.id, slug: p.player.slug })} style={{ color: 'var(--cool)', textDecoration: 'none' }}>{p.player.fullName}</Link>
                      <span className="mono tnum" style={{ color: 'var(--faint)', fontSize: 10 }}>{p.observationCount} apps{minutes !== null ? ` · ${minutes} min` : ''}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

// ═══ PERFORMANCE INDICATORS — descriptive metrics (Performance) ═══════════════════════
//
// The performance.overall metrics plus the per-competition home/away win rates, rendered
// verbatim (value · unit · window · reliability). Below-threshold samples are flagged as
// "small sample". Momentum is inherently signed, so it shows a direction cue; the unsigned
// index metrics show none. Nothing is computed.

function MetricStat({ label, metric, signed = false }: { label: string; metric: PerformanceMetric | null; signed?: boolean }) {
  if (!metric) {
    return (
      <div className="panel-raised" style={{ padding: 10, borderRadius: 6 }}>
        <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
        <p style={{ color: 'var(--faint)', fontSize: 13, marginTop: 4 }}>Not enough data</p>
      </div>
    );
  }
  const dir = signed ? (metric.value > 0 ? { s: '▲', c: 'var(--edge)' } : metric.value < 0 ? { s: '▼', c: 'var(--risk)' } : { s: '·', c: 'var(--muted)' }) : null;
  return (
    <div className="panel-raised" style={{ padding: 10, borderRadius: 6 }}>
      <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>{label}</p>
      <p style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700 }}>{orDash(metric.value)}</span>
        {dir ? <span className="mono" style={{ color: dir.c, fontSize: 13 }} aria-hidden>{dir.s}</span> : null}
      </p>
      <p className="label-cap tnum" style={{ color: 'var(--faint)', fontSize: 9 }}>{metric.unit} · {metric.sample.matches} matches</p>
      {!metric.sample.meetsThreshold ? <p className="label-cap" style={{ color: 'var(--warn)', fontSize: 9 }}>small sample</p> : null}
    </div>
  );
}

export function TeamPerformanceIndicators({ overall, byCompetition = [], coverage }: {
  overall: TeamPerformanceOverall;
  byCompetition?: readonly CompetitionPerformance[];
  coverage: 'present' | 'partial' | 'absent';
}) {
  const hasOverall = !!(overall.homeForm || overall.awayForm || overall.momentum || overall.goalMarginVolatility || overall.giantKillerPpg);
  const primary = byCompetition[0] ?? null;
  return (
    <section className="space-y-2">
      <Eyebrow label="Performance indicators" />
      {coverage === 'absent' && !hasOverall ? (
        <EmptyState message="No performance data available yet." />
      ) : (
        <>
          <div className="panel" style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            <MetricStat label="Home form" metric={overall.homeForm} />
            <MetricStat label="Away form" metric={overall.awayForm} />
            <MetricStat label="Momentum" metric={overall.momentum} signed />
            <MetricStat label="Goal-margin volatility" metric={overall.goalMarginVolatility} />
            <MetricStat label="Vs stronger opponents" metric={overall.giantKillerPpg} />
            {primary && <MetricStat label={`Home win rate · ${primary.edition.competition.name}`} metric={primary.homeWinRate} />}
            {primary && <MetricStat label={`Away win rate · ${primary.edition.competition.name}`} metric={primary.awayWinRate} />}
          </div>
          <p className="label-cap" style={{ color: 'var(--faint)', fontSize: 9 }}>
            Descriptive indicators over the stated window, across all competitions — not a prediction. Goal-margin volatility is size only (no direction). Each shows its own sample.
          </p>
        </>
      )}
    </section>
  );
}

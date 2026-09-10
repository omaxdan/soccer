// ─────────────────────────────────────────────────────────────────────────────
// SEASON RESOLUTION — current-season selection from the provider season catalogue
//
// The first task of config-driven onboarding needs one reliable, reusable
// capability: given an authoritative provider tournament id, decide WHICH season
// is the current one to onboard. This file is the RESOLUTION half — pure, with no
// network and no database — so it is exhaustively testable against captured
// provider evidence and synthetic edge cases. The DISCOVERY half (fetching the
// catalogue) lives in orchestration/seasonDiscovery.ts; GOVERNANCE and INGESTION
// stay where they already are. Discovering a season here authorizes NOTHING.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE PROVIDER ACTUALLY RETURNS — AND WHAT IT DOES NOT
//
// Captured evidence (docs/api-samples/v2-discovery/tournament_seasons__*) shows a
// season object carries ONLY:  { id, name, year, tournamentId }.  There is NO
// start date, NO end date, and NO status field. So the resolver cannot key on
// dates or a status the provider never sends — it must derive a season's temporal
// span from `year`, of which this feed uses two shapes:
//
//   CALENDAR  "2026"      — a calendar-year competition (Brazil): Jan–Dec 2026.
//   SPLIT     "26/27"     — a European season straddling a year boundary
//                           (England/Germany/Austria): ~Jul 2026 – Jun 2027.
//
// The catalogue is returned newest-first, so array POSITION is a real signal —
// but a weak one on its own (a provider may prepend a not-yet-started season, or
// stall during the off-season). Position is therefore used only to LABEL how a
// choice was reached and to break the "first candidate agrees with metadata"
// case; the decision itself is made from the parsed year against the runtime
// clock. Numeric id is NEVER a selection criterion — a larger id is not a later
// season by contract, only by coincidence.
// ─────────────────────────────────────────────────────────────────────────────

/** A season as the provider reports it, normalised and position-tagged. */
export interface ProviderSeasonMeta {
  /** Provider season external id, as text (every provider_external_id is text). */
  readonly id: string;
  readonly name: string;
  /** The provider's `year` string, or null when absent. */
  readonly year: string | null;
  /** 0-based position in the returned catalogue (newest-first by convention). */
  readonly index: number;
  /** The untouched provider object, for diagnosis. */
  readonly raw: Record<string, unknown>;
}

export type SeasonYearFormat = 'CALENDAR' | 'SPLIT' | 'UNKNOWN';
export type SeasonTemporalClass = 'PAST' | 'CURRENT' | 'FUTURE' | 'UNKNOWN';

export interface SeasonSpan {
  readonly format: SeasonYearFormat;
  /** Inclusive lower bound. Absent when the year could not be parsed. */
  readonly startsAt?: Date;
  /** EXCLUSIVE upper bound. Absent when the year could not be parsed. */
  readonly endsBefore?: Date;
}

export interface ClassifiedSeason {
  readonly season: ProviderSeasonMeta;
  readonly span: SeasonSpan;
  readonly temporalClass: SeasonTemporalClass;
}

/**
 * Normalises a raw `tournament_seasons` payload into ordered season metadata.
 *
 * Envelope-aware in exactly the shapes this codebase already recognises (a bare
 * array, `.seasons`, `.data`, `.results`, and `.data.seasons`), mirroring the
 * conservative discovery reader (discover.ts:firstSeasonId) rather than searching
 * creatively — a creative search that found the wrong array would resolve a
 * plausible-looking wrong season. Order is preserved and each entry keeps its
 * index, because newest-first position is a signal the resolver uses.
 */
export function normaliseSeasons(payload: unknown): ProviderSeasonMeta[] {
  const record = (payload && typeof payload === 'object' ? payload : null) as Record<
    string,
    unknown
  > | null;

  const candidates: unknown[] = [payload];
  if (record) {
    for (const key of ['seasons', 'data', 'results']) {
      if (key in record) candidates.push(record[key]);
    }
    const nested = record.data as Record<string, unknown> | undefined;
    if (nested && typeof nested === 'object') {
      for (const key of ['seasons', 'results']) {
        if (key in nested) candidates.push(nested[key]);
      }
    }
  }

  const array = candidates.find((c): c is unknown[] => Array.isArray(c) && c.length > 0);
  if (!array) return [];

  const out: ProviderSeasonMeta[] = [];
  array.forEach((item, index) => {
    const obj = (item && typeof item === 'object' ? item : null) as Record<string, unknown> | null;
    if (!obj) return;
    const rawId = obj.id ?? obj.seasonId;
    if (typeof rawId !== 'number' && !(typeof rawId === 'string' && rawId.length > 0)) return;
    const name = typeof obj.name === 'string' ? obj.name : '';
    const year =
      typeof obj.year === 'string' && obj.year.trim().length > 0 ? obj.year.trim() : null;
    out.push({ id: String(rawId), name, year, index, raw: obj });
  });
  return out;
}

/** 2-digit year to full year, anchored to the 2000s (this provider's range). */
function fullYear(twoOrFour: number): number {
  return twoOrFour >= 100 ? twoOrFour : 2000 + twoOrFour;
}

const CALENDAR_RE = /^(\d{4})$/;
const SPLIT_RE = /^(\d{2}|\d{4})\s*[\/\-]\s*(\d{2}|\d{4})$/;

/**
 * Derives a season's temporal span from `year` (falling back to a year-shaped
 * token in `name`). Two formats, plus UNKNOWN when neither matches.
 *
 * CALENDAR "YYYY"  → [Jan 1 YYYY, Jan 1 YYYY+1)     (Brazil and the like).
 * SPLIT   "YY/YY"  → [Jul 1 Y1,  Jul 1 Y2)          (European Aug→May seasons,
 *                    with the window running to the next July so a just-finished
 *                    season stays "current" through the summer until its
 *                    successor's July start — no artificial off-season gap of a
 *                    few weeks). Y2 is taken from the SECOND token, so a provider
 *                    oddity like "20/22" is honoured rather than assumed +1.
 *
 * All boundaries are UTC — PD-08 requires season reasoning in UTC, and the
 * partition/date machinery elsewhere is already UTC.
 */
export function parseSeasonSpan(year: string | null, name = ''): SeasonSpan {
  const source = (year && year.trim()) || extractYearToken(name);
  if (!source) return { format: 'UNKNOWN' };

  const split = SPLIT_RE.exec(source);
  if (split) {
    const y1 = fullYear(Number(split[1]));
    const y2 = fullYear(Number(split[2]));
    // Guard against a nonsensical descending pair; treat as unknown rather than
    // inventing a backwards span.
    if (y2 < y1) return { format: 'UNKNOWN' };
    return {
      format: 'SPLIT',
      startsAt: new Date(Date.UTC(y1, 6, 1)), // 1 July Y1
      endsBefore: new Date(Date.UTC(y2, 6, 1)), // 1 July Y2 (exclusive)
    };
  }

  const calendar = CALENDAR_RE.exec(source);
  if (calendar) {
    const y = Number(calendar[1]);
    return {
      format: 'CALENDAR',
      startsAt: new Date(Date.UTC(y, 0, 1)),
      endsBefore: new Date(Date.UTC(y + 1, 0, 1)),
    };
  }

  return { format: 'UNKNOWN' };
}

/** A 4-digit year or a YY/YY token embedded in a name, or null. */
function extractYearToken(name: string): string | null {
  const split = name.match(/(\d{2}|\d{4})\s*[\/\-]\s*(\d{2}|\d{4})/);
  if (split) return split[0];
  const calendar = name.match(/\b(\d{4})\b/);
  return calendar ? calendar[1] : null;
}

/** Classifies one season relative to `now` using its derived span. */
export function classifySeason(season: ProviderSeasonMeta, now: Date): ClassifiedSeason {
  const span = parseSeasonSpan(season.year, season.name);
  let temporalClass: SeasonTemporalClass = 'UNKNOWN';
  if (span.startsAt && span.endsBefore) {
    if (now.getTime() < span.startsAt.getTime()) temporalClass = 'FUTURE';
    else if (now.getTime() >= span.endsBefore.getTime()) temporalClass = 'PAST';
    else temporalClass = 'CURRENT';
  }
  return { season, span, temporalClass };
}

export type SeasonResolution =
  | {
      readonly kind: 'RESOLVED';
      readonly season: ProviderSeasonMeta;
      /** CURRENT_FIRST: position and metadata agree. CURRENT_SCAN: metadata found
       *  the current season past a non-current first candidate. */
      readonly basis: 'CURRENT_FIRST' | 'CURRENT_SCAN';
      readonly classified: ClassifiedSeason;
      readonly reason: string;
    }
  | {
      readonly kind: 'RESOLVED_BY_OVERRIDE';
      readonly season: ProviderSeasonMeta;
      readonly classified: ClassifiedSeason;
      readonly reason: string;
    }
  | {
      readonly kind: 'UNRESOLVED';
      readonly reason: string;
      readonly candidatesConsidered: number;
      readonly classified: readonly ClassifiedSeason[];
    };

export interface ResolveOptions {
  /**
   * Operator override for intentional historical/backfill onboarding. When set,
   * the resolver returns that exact season (if present in the catalogue) and does
   * NO current-season reasoning. It still refuses to invent a season the provider
   * did not return.
   */
  readonly overrideSeasonId?: string;
}

/**
 * Selects the current season to onboard, or explains why it cannot.
 *
 * THE RULES, IN ORDER:
 *   0. Empty catalogue → UNRESOLVED (never throws on absent/garbage input).
 *   1. Override present → return that exact season if the catalogue contains it,
 *      else UNRESOLVED (an override naming an unknown season is an operator error,
 *      not a licence to fabricate).
 *   2. Classify every season by its parsed year against `now`.
 *   3. Exactly one CURRENT → RESOLVED. basis is CURRENT_FIRST when that season is
 *      also the first returned (position and metadata agree), else CURRENT_SCAN.
 *   4. No CURRENT → UNRESOLVED (off-season, or only future/ended seasons, or no
 *      parseable metadata). The operator uses --override-season to proceed.
 *   5. More than one CURRENT → UNRESOLVED (ambiguous; refuse rather than guess).
 *
 * Array position never decides alone, and numeric id is never consulted.
 */
export function resolveCurrentSeason(
  seasons: readonly ProviderSeasonMeta[],
  now: Date,
  options: ResolveOptions = {}
): SeasonResolution {
  const classified = seasons.map((s) => classifySeason(s, now));

  if (seasons.length === 0) {
    return {
      kind: 'UNRESOLVED',
      reason: 'the provider returned no seasons for this tournament',
      candidatesConsidered: 0,
      classified,
    };
  }

  if (options.overrideSeasonId !== undefined) {
    const wanted = String(options.overrideSeasonId);
    const hit = classified.find((c) => c.season.id === wanted);
    if (!hit) {
      return {
        kind: 'UNRESOLVED',
        reason: `override season ${wanted} is not among the ${seasons.length} discovered seasons; refusing to onboard a season the provider did not return`,
        candidatesConsidered: seasons.length,
        classified,
      };
    }
    return {
      kind: 'RESOLVED_BY_OVERRIDE',
      season: hit.season,
      classified: hit,
      reason: `operator override: season ${wanted} ("${hit.season.name}"), classified ${hit.temporalClass} — historical/backfill selection, current-season logic bypassed`,
    };
  }

  const currents = classified.filter((c) => c.temporalClass === 'CURRENT');

  if (currents.length === 1) {
    const chosen = currents[0];
    const basis = chosen.season.index === 0 ? 'CURRENT_FIRST' : 'CURRENT_SCAN';
    return {
      kind: 'RESOLVED',
      season: chosen.season,
      basis,
      classified: chosen,
      reason:
        basis === 'CURRENT_FIRST'
          ? `first returned season ("${chosen.season.name}", year ${chosen.season.year}) is current for ${now.toISOString().slice(0, 10)} — position and metadata agree`
          : `first returned season was not current; season ("${chosen.season.name}", year ${chosen.season.year}) at position ${chosen.season.index} is the current one for ${now.toISOString().slice(0, 10)}`,
    };
  }

  if (currents.length === 0) {
    const first = classified[0];
    return {
      kind: 'UNRESOLVED',
      reason: `no season is current for ${now.toISOString().slice(0, 10)} (newest is "${first.season.name}", year ${first.season.year}, classified ${first.temporalClass}). This is an off-season gap, an unstarted future season, or unparseable year metadata — use an explicit --override-season for backfill.`,
      candidatesConsidered: seasons.length,
      classified,
    };
  }

  return {
    kind: 'UNRESOLVED',
    reason: `ambiguous: ${currents.length} seasons classify as current (${currents
      .map((c) => `${c.season.id} "${c.season.name}"`)
      .join(', ')}); refusing to guess`,
    candidatesConsidered: seasons.length,
    classified,
  };
}

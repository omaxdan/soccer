// FIXTURES-BY-DATE — pure presentation/organization logic (DB-free, no React).
//
// The Fixtures workspace consumes GET /api/v2/fixtures/{YYYY-MM-DD} (UTC calendar
// date). This module owns only the pure helpers: UTC date maths for the date strip
// and prev/next/today navigation, route-param validation (same YYYY-MM-DD semantics
// as the API — never a local-timezone conversion), and the lifecycle → display
// mapping (COMPLETED → FT / AET / PEN, IN_PROGRESS → LIVE, …). It fabricates nothing:
// missing results stay missing (a dash), never 0–0.

import type { CalendarFixture, CalendarMatchResult } from './types';

// ── UTC calendar-date helpers ────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a well-formed AND real UTC calendar date (e.g. rejects 2026-13-40). */
export function isValidCalendarDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** The current UTC calendar date (the API's timezone), as YYYY-MM-DD. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Shift a valid YYYY-MM-DD by whole days in UTC. */
export function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface StripDay {
  readonly iso: string;
  readonly dow: string;   // Mon
  readonly num: string;   // 27 Sep
  readonly isCurrent: boolean;
  readonly isToday: boolean;
  readonly aria: string;
}

/** A strip of `count` consecutive UTC days centred on `iso`, for date navigation. */
export function buildDateStrip(iso: string, count: number, today: string): StripDay[] {
  const half = Math.floor(count / 2);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  return Array.from({ length: count }, (_, i) => {
    const k = shiftDate(iso, i - half);
    const d = new Date(`${k}T00:00:00.000Z`);
    const isToday = k === today;
    return {
      iso: k,
      dow: fmt(d, { weekday: 'short' }),
      num: fmt(d, { day: 'numeric', month: 'short' }),
      isCurrent: k === iso,
      isToday,
      aria: fmt(d, { weekday: 'long', day: 'numeric', month: 'long' }) + (isToday ? ', today' : ''),
    };
  });
}

/** A long, human UTC date, e.g. "Sunday, 6 September 2026". */
export function formatLongUtc(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** The UTC HH:MM of a kickoff ISO instant. */
export function kickoffHHMM(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── lifecycle → display (presentation mapping only; backend value is authoritative) ─

export interface StatusPresentation {
  readonly label: string;       // FT / LIVE / UPCOMING / POSTPONED / …
  readonly color: string;       // semantic token
  readonly glyph: string;       // small mark (text, never the only signal)
  readonly dashed: boolean;     // dashed border for UNKNOWN
  readonly live: boolean;       // pulse the glyph
  readonly word: string;        // full accessible word
}

const STATUS: Record<string, readonly [string, string, string, boolean, string]> = {
  SCHEDULED: ['UPCOMING', 'var(--cool)', '○', false, 'upcoming'],
  IN_PROGRESS: ['LIVE', 'var(--amber)', '●', false, 'live'],
  COMPLETED: ['FT', 'var(--edge)', '■', false, 'full time'],
  AET: ['AET', 'var(--edge)', '■', false, 'after extra time'],
  PEN: ['PEN', 'var(--edge)', '■', false, 'decided on penalties'],
  POSTPONED: ['POSTPONED', 'var(--warn)', '▲', false, 'postponed'],
  ABANDONED: ['ABANDONED', 'var(--warn)', '▲', false, 'abandoned'],
  CANCELLED: ['CANCELLED', 'var(--risk)', '✕', false, 'cancelled'],
  UNKNOWN: ['STATUS UNKNOWN', 'var(--faint)', '?', true, 'status unknown'],
};

/** Present a fixture's lifecycle for display. COMPLETED becomes FT, or AET/PEN when
 *  the canonical result says so. Unknown/other states fall back honestly. */
export function statusPresentation(status: string, result: CalendarMatchResult | null): StatusPresentation {
  let key = status;
  if (status === 'COMPLETED' && result) {
    if (result.penalties) key = 'PEN';
    else if (result.extraTime) key = 'AET';
  }
  const [label, color, glyph, dashed, word] = STATUS[key] ?? STATUS.UNKNOWN;
  return { label, color, glyph, dashed, live: status === 'IN_PROGRESS', word };
}

export interface ScorePresentation {
  readonly show: boolean;       // a real scoreline is shown
  readonly missing: boolean;    // completed but no confirmed result → em dash
  readonly home: number | null;
  readonly away: number | null;
}

/** Whether/how to show a scoreline. Shown for COMPLETED and IN_PROGRESS with a score;
 *  COMPLETED without a confirmed result is an honest missing state (never 0–0). */
export function scorePresentation(f: CalendarFixture): ScorePresentation {
  const fin = f.result?.final ?? f.score ?? null;
  const has = fin !== null && fin !== undefined;
  const show = has && (f.status === 'COMPLETED' || f.status === 'IN_PROGRESS');
  const missing = f.status === 'COMPLETED' && !has;
  return { show, missing, home: show ? fin!.home : null, away: show ? fin!.away : null };
}

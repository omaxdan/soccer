// ─────────────────────────────────────────────────────────────────────────────
// MATCH RAW STATISTICS — NORMALISATION (Task 6C)
//
// Pure shape conversions from the VERIFIED live provider payloads into the row
// shapes migration 034 stores. No database, no network, no derived metric — the
// transformations only restructure what the provider returned, preserving raw
// fidelity. Persistence (resolving provider ids to internal ids and upserting)
// is a separate step; these functions stay pure and fully testable against the
// captured payload.
//
// Canonical sources (Task 6B, verified):
//   team statistics  ← /match/{id}/statistics
//   player statistics + lineups ← /match/{id}/lineups   (/player-statistics is a
//                                  verified ALIAS and is never read separately)
//
// ─────────────────────────────────────────────────────────────────────────────
// TEAM IDENTITY IS THE SIDE, NOT THE LINEUP'S teamId  (run-278 finding)
//
// The player's `teamId` in a lineup payload is in a DIFFERENT id space than the
// fixture's teams: live match 15237975 carries `teamId 34318`, while the fixture
// records Fluminense as provider id 1961 and Bragantino as 1999. So the lineup's
// teamId cannot resolve a relational team and is IGNORED for identity. What the
// payload states reliably is which SIDE a player is on (data.home / data.away),
// and the fixture is the authoritative source of which internal team each side
// is. These functions therefore emit `side`; the persistence step maps
// home → fixture.home_team_id and away → fixture.away_team_id. Player identity
// still travels as the provider player id, which IS a resolvable key.
// ─────────────────────────────────────────────────────────────────────────────

import { asRecord, externalId, text } from '../normalise';

/** Which side of the fixture a lineup row belongs to. The relational team is the
 * fixture's team for that side — never the lineup payload's teamId. */
export type MatchSide = 'home' | 'away';

/** A normalised team-level match statistic (one provider statisticsItem). */
export interface TeamMatchStatisticRow {
  readonly period: string;
  readonly groupName: string;
  readonly statisticKey: string;
  readonly statisticName: string | null;
  readonly homeValue: string | null;
  readonly awayValue: string | null;
  readonly homeDisplay: string | null;
  readonly awayDisplay: string | null;
  readonly valueType: string | null;
  readonly compareCode: string | null;
  readonly statisticsType: string | null;
  readonly renderType: string | null;
}

/** A normalised per-player match statistic (one key of the player statistics object). */
export interface PlayerMatchStatisticRow {
  readonly playerProviderId: string;
  /** The fixture side the player is on; the relational team is the fixture's team for this side. */
  readonly side: MatchSide;
  readonly statisticKey: string;
  readonly statisticValue: string;
  /** Shape tag ONLY: 'number' for a scalar, 'json' for a nested object/array. Not a provider claim. */
  readonly valueType: 'number' | 'json';
}

/** A normalised actual-lineup team row. */
export interface LineupRow {
  /** The fixture side; the relational team is the fixture's team for this side. */
  readonly side: MatchSide;
  readonly formation: string | null;
}

/** A normalised lineup selection (one player's participation facts). */
export interface LineupSelectionRow {
  /** The fixture side; the relational team is the fixture's team for this side. */
  readonly side: MatchSide;
  readonly playerProviderId: string;
  /**
   * The provider's display name for the player, carried so identity resolution
   * does not have to re-walk the payload. It is the ONE biographical field the
   * lineup payload states; everything else (date of birth, height, nationality)
   * is absent here and stays null until squad ingestion enriches it.
   */
  readonly playerName: string | null;
  readonly shirtNumber: number | null;
  readonly positionCode: string | null;
  readonly isStarting: boolean;
  readonly isCaptain: boolean;
}

/** A raw scalar the provider may emit for a statistic value. */
function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** Stringifies a numeric/other value for raw text storage without guessing a type. */
function rawText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Normalises /match/{id}/statistics into team-statistic rows.
 *
 * Envelope: `{data:{statistics:[{period, groups:[{groupName, statisticsItems:[…]}]}]}}`.
 * A provider `key` recurs across groups within one period, so each row keeps its
 * `groupName` — that is what makes (period, groupName, key) a safe identity.
 * Items without a usable `key` are skipped (they cannot be keyed), never guessed.
 */
export function normaliseTeamMatchStatistics(payload: unknown): TeamMatchStatisticRow[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const periods = Array.isArray(data?.statistics) ? (data?.statistics as unknown[]) : [];
  const rows: TeamMatchStatisticRow[] = [];

  for (const p of periods) {
    const periodObj = asRecord(p);
    const period = text(periodObj?.period);
    if (!period) continue;
    const groups = Array.isArray(periodObj?.groups) ? (periodObj?.groups as unknown[]) : [];
    for (const g of groups) {
      const groupObj = asRecord(g);
      const groupName = text(groupObj?.groupName);
      if (!groupName) continue;
      const items = Array.isArray(groupObj?.statisticsItems) ? (groupObj?.statisticsItems as unknown[]) : [];
      for (const it of items) {
        const item = asRecord(it);
        const key = text(item?.key);
        if (!item || !key) continue;
        rows.push({
          period,
          groupName,
          statisticKey: key,
          statisticName: text(item.name),
          homeValue: rawText(item.homeValue),
          awayValue: rawText(item.awayValue),
          homeDisplay: text(item.home),
          awayDisplay: text(item.away),
          valueType: text(item.valueType),
          compareCode: rawText(item.compareCode),
          statisticsType: text(item.statisticsType),
          renderType: rawText(item.renderType),
        });
      }
    }
  }
  return rows;
}

/** The two player arrays of a /lineups payload, tagged by side. */
function lineupSides(payload: unknown): Array<{ side: 'home' | 'away'; players: unknown[] }> {
  const data = asRecord(asRecord(payload)?.data);
  const out: Array<{ side: 'home' | 'away'; players: unknown[] }> = [];
  for (const side of ['home', 'away'] as const) {
    const sideObj = asRecord(data?.[side]);
    // Canonical /lineups nests players under data.<side>.players; the verified
    // alias nests the array directly under data.<side>. Accept either shape so a
    // future capture using the alias envelope still normalises identically.
    const players = Array.isArray(sideObj?.players)
      ? (sideObj?.players as unknown[])
      : Array.isArray(data?.[side])
        ? (data?.[side] as unknown[])
        : [];
    out.push({ side, players });
  }
  return out;
}

/**
 * Normalises the per-player `statistics` OBJECT from /lineups into one row per
 * key. Because the payload is a JSON object, keys are unique by construction, so
 * a player cannot produce a duplicate statistic key. Nested objects (e.g.
 * `ratingVersions`, `statisticsType`) are preserved as JSON text rather than
 * discarded or flattened into derived fields.
 */
export function normalisePlayerMatchStatistics(lineupsPayload: unknown): PlayerMatchStatisticRow[] {
  const rows: PlayerMatchStatisticRow[] = [];
  for (const { side, players } of lineupSides(lineupsPayload)) {
    for (const entry of players) {
      const e = asRecord(entry);
      const playerProviderId = externalId(asRecord(e?.player)?.id);
      const stats = asRecord(e?.statistics);
      // The lineup teamId is deliberately NOT read — the relational team is the
      // fixture's team for this side. A row needs only a resolvable player id and
      // a statistics object.
      if (!playerProviderId || !stats) continue;
      for (const [key, value] of Object.entries(stats)) {
        const asText = rawText(value);
        if (asText === null) continue;
        rows.push({
          playerProviderId,
          side,
          statisticKey: key,
          statisticValue: asText,
          valueType: isScalar(value) ? 'number' : 'json',
        });
      }
    }
  }
  return rows;
}

/**
 * Normalises the actual lineup facts from /lineups: one LineupRow per side and
 * one LineupSelectionRow per player. `is_starting = !substitute`; `is_captain`
 * follows the present-only-when-true provider `captain` flag. Nothing derived.
 */
export function normaliseLineups(lineupsPayload: unknown): {
  lineups: LineupRow[];
  selections: LineupSelectionRow[];
} {
  const data = asRecord(asRecord(lineupsPayload)?.data);
  const lineups: LineupRow[] = [];
  const selections: LineupSelectionRow[] = [];

  for (const { side, players } of lineupSides(lineupsPayload)) {
    const sideObj = asRecord(data?.[side]);
    // The side's relational team is the fixture's team for this side, resolved at
    // persistence — the lineup teamId is not read here. A player needs only a
    // resolvable provider id to be a selection.
    let sawPlayer = false;
    for (const entry of players) {
      const e = asRecord(entry);
      const pid = externalId(asRecord(e?.player)?.id);
      if (!pid) continue;
      sawPlayer = true;
      const shirtRaw = e?.shirtNumber;
      selections.push({
        side,
        playerProviderId: pid,
        playerName: text(asRecord(e?.player)?.name),
        shirtNumber: typeof shirtRaw === 'number' && Number.isFinite(shirtRaw) ? shirtRaw : null,
        positionCode: text(e?.position),
        isStarting: e?.substitute === false,
        isCaptain: e?.captain === true,
      });
    }
    if (sawPlayer) {
      lineups.push({ side, formation: text(sideObj?.formation) });
    }
  }
  return { lineups, selections };
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT CONTENT CHECKSUM — canonical serialisation (S-7, algorithm version v1)
//
// A.6 / R-24 / R-25. Each sealed snapshot stores a content_checksum computed over
// a DETERMINISTIC serialisation of its aggregate content, in the order the
// referenced checksum algorithm version declares. The seeded `v1` row
// (migration 003) fixes both the digest (`sha256`) and the canonical form:
//
//   "Aggregate content serialised in the order: header, version manifest,
//    feature state by cited value key, module readings by cited reading key,
//    model outputs by model then output type, completeness items, verdict."
//
// This module implements exactly that order. The database's own
// `operations.fn_verify_snapshot_checksums` is a deliberate stub (it returns
// NULL until a procedural serialisation exists), so THIS is the authoritative
// producer; determinism is proven by the DB-free tests rather than by a second
// SQL implementation.
//
// CANONICALISATION RULES (the "v1" canonical form, stated once, tested):
//   • object keys       — lexicographic ascending
//   • arrays            — the CALLER orders them by the declared key; this module
//                         preserves that order (never re-sorts content)
//   • strings           — JSON double-quoted (JSON.stringify)
//   • integers          — decimal string; a non-integer JS number is REJECTED so
//                         a float-formatting hazard can never enter the digest
//   • decimals (values) — carried as their PostgreSQL numeric text verbatim
//                         (scale preserved), wrapped so they are distinct from
//                         both integers and strings
//   • booleans          — true / false
//   • null              — the bare token `null`, distinct from the quoted string
//                         "null" (absence is never confused with a value)
//   • timestamps        — ISO-8601 UTC microseconds (see `canonicalTimestamp`)
//   • enums / codes      — their code string, quoted like any string
//
// A NEW canonical form or digest is a NEW checksum_algorithm_version row; existing
// sealed snapshots are never recomputed under it (R-28). This module therefore
// encodes ONLY v1 and names it.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

/** The algorithm version designation this module implements. */
export const CHECKSUM_ALGORITHM_DESIGNATION = 'v1' as const;
export const CHECKSUM_DIGEST_ALGORITHM = 'sha256' as const;

/** A PostgreSQL numeric carried as text, so its declared scale is preserved verbatim. */
export interface CanonicalDecimal {
  readonly __decimal: string;
}
/** Wrap a numeric's text form (e.g. '80.00') so serialisation keeps it exact. */
export function decimal(text: string): CanonicalDecimal {
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`canonical decimal must be plain numeric text, got: ${text}`);
  }
  return { __decimal: text };
}

/** A value the canonical serialiser accepts. */
export type Canonical =
  | string
  | number
  | boolean
  | null
  | CanonicalDecimal
  | Date
  | readonly Canonical[]
  | { readonly [key: string]: Canonical };

function isDecimal(v: unknown): v is CanonicalDecimal {
  return typeof v === 'object' && v !== null && '__decimal' in v;
}

/**
 * ISO-8601 in UTC with microsecond precision. A JS Date carries milliseconds, so
 * the extra three digits are always '000' here — deliberately fixed, so the width
 * is stable and a future microsecond-bearing source cannot silently change the
 * serialisation width (ER-01 discipline: the string form is what is hashed).
 */
export function canonicalTimestamp(d: Date): string {
  const ms = d.toISOString(); // e.g. 2027-07-01T00:00:00.000Z
  return ms.replace(/\.(\d{3})Z$/, '.$1000Z');
}

/** Deterministically serialise a canonical value to a string. Pure. */
export function canon(value: Canonical): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`canonical serialisation rejects non-integer number ${value}; wrap decimals with decimal()`);
    }
    return String(value);
  }
  if (value instanceof Date) return JSON.stringify(canonicalTimestamp(value));
  if (isDecimal(value)) return `#${value.__decimal}`; // '#'-prefixed → distinct from int and string
  if (Array.isArray(value)) {
    return `[${value.map((v) => canon(v as Canonical)).join(',')}]`;
  }
  // object: keys lexicographic ascending
  const obj = value as { readonly [key: string]: Canonical };
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`).join(',')}}`;
}

/**
 * The ordered aggregate the v1 canonical form hashes. The caller supplies each
 * section already ordered by its declared key; this type fixes the SECTION order,
 * which is the load-bearing part of the algorithm version.
 */
export interface SnapshotContent {
  readonly header: Canonical;
  readonly versionManifest: readonly Canonical[];   // ordered by (component_kind, designation)
  readonly featureState: readonly Canonical[];      // ordered by cited value key
  readonly moduleReadings: readonly Canonical[];    // ordered by cited reading key
  readonly modelOutputs: readonly Canonical[];      // ordered by (model, output type); empty in v1.0.0
  readonly completenessItems: readonly Canonical[]; // ordered
  readonly verdict: Canonical;
}

/** Builds the canonical string for a snapshot's content, in the v1 declared order. */
export function canonicalString(content: SnapshotContent): string {
  const ordered: Canonical = [
    content.header,
    [...content.versionManifest],
    [...content.featureState],
    [...content.moduleReadings],
    [...content.modelOutputs],
    [...content.completenessItems],
    content.verdict,
  ];
  return canon(ordered);
}

/** The SHA-256 digest (32 bytes) over the canonical string — the stored content_checksum. */
export function contentChecksum(content: SnapshotContent): Buffer {
  return createHash('sha256').update(canonicalString(content), 'utf8').digest();
}

/** Hex form, for logging and test assertions. */
export function contentChecksumHex(content: SnapshotContent): string {
  return contentChecksum(content).toString('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXACT DECIMAL ARITHMETIC AND THE SINGLE ROUNDING BOUNDARY
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY NOT `number`
//
// PD-06: "Values are exact numerics. Binary floating point is not used, because
// calibration compares for equality and replay must not depend on aggregation
// order."
//
// Both halves of that matter. Calibration compares stored values for equality,
// and 0.1 + 0.2 !== 0.3 in IEEE 754. Replay must be reproducible, and floating
// point addition is not associative, so a differently ordered sum yields a
// different result — which is exactly the non-determinism R-2 forbids.
//
// So every quantity that reaches feature_value.value is carried as an `Exact`:
// a bigint of scaled units plus a scale. 12345 at scale 2 is 123.45, held with
// no representation error at any magnitude.
//
// ─────────────────────────────────────────────────────────────────────────────
// "ROUND ONCE, AT THE WRITE BOUNDARY" — AND WHAT DIVISION DOES ABOUT IT
//
// Division cannot be exact in a fixed-point representation: 100/15 has no finite
// decimal expansion. Something must decide how many digits to keep.
//
// The rule is applied as follows, and the distinction is the whole point:
//
//   DIVISION works at WORKING_SCALE (20 digits), far below any observable
//   precision. It is not "rounding the value" — it is choosing a representation
//   precise enough that the choice cannot affect the result.
//
//   THE WRITE BOUNDARY rounds ONCE, half-up, to the scale the registry declares
//   for the feature. This is the only rounding that decides an output digit.
//
// The intermediate precision is safe by a wide margin rather than by hope. Every
// divisor in S-5 is small and fixed — 15, 30, 7, 2 — so exact values are
// rationals whose decimal expansions either terminate or repeat with a short
// period. The nearest such value can come to a half-way boundary at scale 2
// without landing exactly on it is on the order of 1e-3, and the working
// representation is accurate to 1e-20. Eighteen orders of magnitude of headroom.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An exact decimal: `units / 10^scale`.
 *
 * Immutable. Every operation returns a new value, so an Exact can be shared
 * between calculators without any possibility of one mutating another's input.
 */
export interface Exact {
  readonly units: bigint;
  readonly scale: number;
}

/**
 * Digits carried through intermediate arithmetic.
 *
 * Twenty, which is not a tuning parameter — see the header. It exists so that
 * division has a defined result, not so that precision can be traded away.
 */
export const WORKING_SCALE = 20;

const TEN = 10n;

function pow10(n: number): bigint {
  return TEN ** BigInt(n);
}

/** An exact value from scaled units. */
export function exact(units: bigint, scale: number): Exact {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`scale must be a non-negative integer, received ${scale}`);
  }
  return { units, scale };
}

/** An exact value from a whole number. */
export function fromInt(value: number | bigint): Exact {
  const asBigInt = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new RangeError(`fromInt requires an integer, received ${value}`);
  }
  return exact(asBigInt, 0);
}

/**
 * An exact value parsed from a decimal string.
 *
 * THE ONLY SUPPORTED WAY TO INTRODUCE A FRACTIONAL LITERAL. There is no
 * `fromNumber`, deliberately: accepting a `number` would let 0.1 enter the
 * system already wrong, and no amount of exact arithmetic afterwards would
 * recover it.
 *
 * This is also how values arrive from PostgreSQL. The `pg` driver returns
 * `numeric` as a string precisely because it does not fit a double, and parsing
 * it here preserves every digit the database stored.
 */
export function fromString(value: string): Exact {
  const text = value.trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) {
    throw new RangeError(`not an exact decimal literal: '${value}'`);
  }
  const negative = text.startsWith('-');
  const unsigned = text.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const units = BigInt(whole + fraction);
  return exact(negative ? -units : units, fraction.length);
}

/** The same value carried at a different scale. Widening only; never narrows. */
export function rescale(value: Exact, scale: number): Exact {
  if (scale === value.scale) return value;
  if (scale < value.scale) {
    throw new RangeError(
      `rescale widens only — narrowing ${value.scale} to ${scale} would discard digits. ` +
        'Use roundHalfUp, which states that it is rounding.'
    );
  }
  return exact(value.units * pow10(scale - value.scale), scale);
}

/** Both operands at their common (wider) scale. */
function align(a: Exact, b: Exact): [Exact, Exact] {
  const scale = Math.max(a.scale, b.scale);
  return [rescale(a, scale), rescale(b, scale)];
}

export function add(a: Exact, b: Exact): Exact {
  const [x, y] = align(a, b);
  return exact(x.units + y.units, x.scale);
}

export function subtract(a: Exact, b: Exact): Exact {
  const [x, y] = align(a, b);
  return exact(x.units - y.units, x.scale);
}

/** Exact by construction — the product's scale is the sum of the operands'. */
export function multiply(a: Exact, b: Exact): Exact {
  return exact(a.units * b.units, a.scale + b.scale);
}

/**
 * Division at WORKING_SCALE, with the final digit rounded half away from zero.
 *
 * The rounding here is a REPRESENTATION choice at twenty digits, not an output
 * decision — see the header. Dividing by zero raises rather than returning a
 * sentinel: a zero divisor in any S-5 formula means the caller failed to check
 * for an empty window, and a substituted value would hide that.
 */
export function divide(a: Exact, b: Exact, scale: number = WORKING_SCALE): Exact {
  if (b.units === 0n) {
    throw new RangeError('division by zero — the caller must exclude the empty case first');
  }
  // Numerator lifted so the quotient lands at `scale`, plus one guard digit for
  // the half-away-from-zero decision.
  const shift = scale + b.scale - a.scale + 1;
  const lifted = shift >= 0 ? a.units * pow10(shift) : a.units / pow10(-shift);
  const quotient = lifted / b.units;

  const negative = quotient < 0n;
  const magnitude = negative ? -quotient : quotient;
  const truncated = magnitude / TEN;
  const guard = magnitude % TEN;
  const rounded = guard >= 5n ? truncated + 1n : truncated;
  return exact(negative ? -rounded : rounded, scale);
}

export function compare(a: Exact, b: Exact): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  if (x.units < y.units) return -1;
  if (x.units > y.units) return 1;
  return 0;
}

export function isZero(value: Exact): boolean {
  return value.units === 0n;
}

export function minimum(a: Exact, b: Exact): Exact {
  return compare(a, b) <= 0 ? a : b;
}

export function maximum(a: Exact, b: Exact): Exact {
  return compare(a, b) >= 0 ? a : b;
}

/** Bounded to `[low, high]`. */
export function clamp(value: Exact, low: Exact, high: Exact): Exact {
  return minimum(maximum(value, low), high);
}

/**
 * Rounds half-up to a target scale. **The single output rounding boundary.**
 *
 * "Half-up" is implemented as half away from zero. Every S-5 value is
 * non-negative — indices are bounded to 0–100 and rest days cannot be negative —
 * so the two readings of "half-up" never diverge in practice. It is implemented
 * correctly regardless, because a rounding rule that is only correct for the
 * inputs someone happened to think of is not a rounding rule.
 *
 * MUST be called exactly once per value, at the write boundary. Calling it on an
 * intermediate and again on the result is double rounding, which can move a
 * value by a full unit of the last place: 1.4449 → 1.445 → 1.45, where a single
 * rounding gives 1.44.
 */
export function roundHalfUp(value: Exact, targetScale: number): Exact {
  if (!Number.isInteger(targetScale) || targetScale < 0) {
    throw new RangeError(`targetScale must be a non-negative integer, received ${targetScale}`);
  }
  if (targetScale >= value.scale) return rescale(value, targetScale);

  const drop = value.scale - targetScale;
  const divisor = pow10(drop);
  const negative = value.units < 0n;
  const magnitude = negative ? -value.units : value.units;

  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  // Half is exactly half the divisor; `>=` is what makes it round half UP
  // rather than half-even.
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return exact(negative ? -rounded : rounded, targetScale);
}

/**
 * The canonical decimal string, for binding to a `numeric` parameter.
 *
 * Bound as TEXT and cast by PostgreSQL, never converted to a JavaScript number.
 * A round trip through `Number` would defeat every guarantee in this file at the
 * last possible moment.
 */
export function toNumericString(value: Exact): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString();
  if (value.scale === 0) return negative ? `-${digits}` : digits;

  const padded = digits.padStart(value.scale + 1, '0');
  const whole = padded.slice(0, padded.length - value.scale);
  const fraction = padded.slice(padded.length - value.scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Frequently used constants, so callers do not restate literals. */
export const ZERO = fromInt(0);
export const ONE = fromInt(1);
export const ONE_HUNDRED = fromInt(100);

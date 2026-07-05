// ─── DESIGN TOKENS — now CSS-variable-backed for light/dark theming ─────────
// Previously hardcoded hex. The TopBar theme toggle and the full
// [data-theme="light"] variable set in globals.css already existed and
// worked — but every inline style read these hardcoded hex values, so
// toggling the theme changed only class-based CSS and left the (vast)
// inline-styled majority of the app permanently dark. Pointing these at
// the CSS variables makes every existing inline style theme-aware in one
// change, without rewriting thousands of style objects.
//
// CONSTRAINT this creates: alpha-suffix concatenation (hex suffix appended
// alpha-suffix concatenation produces invalid CSS against a var()
// ('var(--green)20') — the exact bug class fixed once before in
// globals.css. Every such site (56 found via grep) was converted to
// withAlpha() below in the same commit as this change.

export const COLORS = {
  // Backgrounds
  bg:       'var(--bg)',
  surface:  'var(--surface)',
  surface2: 'var(--surface2)',
  surface3: 'var(--surface3)',

  // Borders
  border:   'var(--border)',
  border2:  'var(--border2)',

  // Text
  text:    'var(--text)',
  text2:   'var(--text2)',
  muted:   'var(--muted)',
  dim:     'var(--dim)',

  // Accents
  green:   'var(--green)',
  greenDim:'var(--green2)',
  amber:   'var(--amber)',
  orange:  'var(--orange)',
  red:     'var(--red)',
  blue:    'var(--blue)',
  purple:  'var(--purple)',
} as const;

/** Alpha-tinted color that works with CSS variables. Replaces the
 *  hex-suffix concatenation pattern, which produces invalid
 *  CSS against var() tokens. Accepts the same 2-digit hex alpha the old
 *  pattern used, converts it to a percentage, and returns a color-mix()
 *  — works identically for var() and raw hex inputs. */
export function withAlpha(color: string, hexAlpha: string): string {
  const pct = Math.round((parseInt(hexAlpha, 16) / 255) * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// Score color banding — exact from spec
// 85–100: #00e676 + glow  ← elite
// 65–84:  #69f0ae         ← good
// 45–64:  #ffb300         ← moderate
// 25–44:  #ff6d00         ← poor
// 0–24:   #ff1744         ← critical
// null:   #555570 + "—"   ← data pending
export function scoreColor(s: number | null | undefined): string {
  if (s == null) return COLORS.dim;
  if (s >= 85) return COLORS.green;
  if (s >= 65) return COLORS.greenDim;
  if (s >= 45) return COLORS.amber;
  if (s >= 25) return COLORS.orange;
  return COLORS.red;
}

export function scoreGlow(s: number | null | undefined): string {
  if (s == null) return 'none';
  if (s >= 85) return `drop-shadow(0 0 8px ${withAlpha(COLORS.green, '60')})`;
  return 'none';
}

export function scoreBg(s: number | null | undefined): string {
  return withAlpha(scoreColor(s), '18');
}

export function scoreBorder(s: number | null | undefined): string {
  return withAlpha(scoreColor(s), '40');
}

// Typography — exact from spec
export const TYPE = {
  heroScore:     { fontFamily: '"JetBrains Mono","Courier New",monospace', fontSize: 56, fontWeight: 700 },
  sectionHeader: { fontFamily: 'Inter,system-ui,sans-serif', fontSize: 14, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: COLORS.muted },
  cardValue:     { fontFamily: '"JetBrains Mono","Courier New",monospace', fontSize: 28, fontWeight: 600 },
  label:         { fontFamily: 'Inter,system-ui,sans-serif', fontSize: 12, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: COLORS.muted },
  body:          { fontFamily: 'Inter,system-ui,sans-serif', fontSize: 14, color: COLORS.text },
  smallData:     { fontFamily: 'Inter,system-ui,sans-serif', fontSize: 11, color: COLORS.muted },
  mono:          { fontFamily: '"JetBrains Mono","Courier New",monospace' },
} as const;

// Signal strength labels
export const STRENGTH_LABELS = ['', 'Very Low', 'Low', 'Moderate', 'Good', 'Strong', 'Very Strong'];

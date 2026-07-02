// ─── EXACT DESIGN TOKENS FROM RIP FRONTEND DESIGN PROMPT ─────────────────────
// All hex values, score bands, and typography as specified.

export const COLORS = {
  // Backgrounds
  bg:       '#0a0a0f',
  surface:  '#111118',
  surface2: '#1a1a24',
  surface3: '#22223a',

  // Borders
  border:   '#2a2a3a',
  border2:  '#3a3a50',

  // Text
  text:    '#f0f0ff',
  text2:   '#c8c8e0', // insight/body copy — softer than `text` (headlines),
                       // brighter than `muted` (labels). Was referenced
                       // across 4 pages this session before being defined —
                       // adding it here fixes all of them at once rather
                       // than patching each usage individually.
  muted:   '#8888aa',
  dim:     '#555570',

  // Accents
  green:   '#00e676',
  greenDim:'#69f0ae',
  amber:   '#ffb300',
  orange:  '#ff6d00',
  red:     '#ff1744',
  blue:    '#2979ff',
  purple:  '#aa00ff',
} as const;

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
  if (s >= 85) return `drop-shadow(0 0 8px ${COLORS.green}60)`;
  return 'none';
}

export function scoreBg(s: number | null | undefined): string {
  return scoreColor(s) + '18';
}

export function scoreBorder(s: number | null | undefined): string {
  return scoreColor(s) + '40';
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

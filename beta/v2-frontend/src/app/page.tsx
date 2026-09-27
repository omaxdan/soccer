import type { Metadata } from 'next';
import { LandingPage } from '@/components/v2/landing';

// Public root route (B1 Landing). The marketing entry point for PitchTerminal —
// football intelligence, evidence-first, pre-match. It renders inside the Phase A
// shell (app/layout.tsx) and is fully static: no API calls, no runtime calculation.
// The app itself (leagues / fixtures / matches …) lives under /v2, reached from the
// landing's "Explore fixtures" CTA and the shell nav.
export const metadata: Metadata = {
  title: 'PitchTerminal — Football Intelligence',
  description:
    'PitchTerminal brings fixtures, team form, match context and historical patterns into one structured view, so you can read a match from the evidence up. Evidence-first pre-match football intelligence — no odds, no picks.',
};

export default function Home() {
  return <LandingPage />;
}

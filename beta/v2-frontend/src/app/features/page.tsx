import type { Metadata } from 'next';
import { FeaturesPage } from '@/components/v2/features';

// Public Features / Intelligence page (B2). Explains how PitchTerminal turns a
// fixture into an evidence-first read of a match — the six-question framework
// (Fixture, Performance, Readiness, Context, History, Intelligence) with evidence
// under every step. Renders inside the Phase A shell; fully static (no API calls).
export const metadata: Metadata = {
  title: 'Features — PitchTerminal',
  description:
    'How PitchTerminal works: fixtures and results, team performance, readiness, match context, historical patterns and match intelligence — evidence-first, pre-match football intelligence. Readings interpret evidence; they do not predict results.',
};

export default function Features() {
  return <FeaturesPage />;
}

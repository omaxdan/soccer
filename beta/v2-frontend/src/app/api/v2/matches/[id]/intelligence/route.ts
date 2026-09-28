// FRONTEND ROUTE HANDLER — read-only proxy for one fixture's sealed intelligence.
//
// The Fixtures workspace is a client component and cannot reach the V2 backend
// directly (the API base is server-side only; there is no browser-exposed base and
// no CORS grant). This thin handler runs on the Next server, calls the SAME
// server-side read the Match page uses (fetchMatchIntelligence), and returns its
// result to the browser so the fixtures preview can show the selected fixture's
// reading on demand.
//
// It adds NO new data: it forwards the existing /matches/:id/intelligence read
// verbatim. A sealed fixture returns { intelligence, context }; an unsealed one
// returns null (200) — an honest "no reading yet", never a fabricated one. It never
// mutates and never touches the backend contract.

import { NextResponse } from 'next/server';
import { fetchMatchIntelligence } from '@/lib/v2/api';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'invalid fixture id' }, { status: 400 });
  }
  try {
    const data = await fetchMatchIntelligence(id); // MatchIntelligenceResponse | null
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'upstream unavailable' }, { status: 502 });
  }
}

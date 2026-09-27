// Server-side loader for the Fixtures workspace. Fetches the real
// GET /api/v2/fixtures/{date} read and assembles the serializable props for the
// (client) FixturesWorkspace. A network/HTTP failure becomes an honest `errored`
// flag (the workspace renders the failed state) rather than throwing the page.

import { fetchFixturesByDate } from './api';
import { todayUtc, shiftDate, buildDateStrip } from './fixtures';
import type { FixturesWorkspaceProps } from '@/components/v2/fixtures';

export async function loadFixturesProps(date: string): Promise<FixturesWorkspaceProps> {
  const today = todayUtc();
  let response: Awaited<ReturnType<typeof fetchFixturesByDate>> = null;
  let errored = false;
  try {
    response = await fetchFixturesByDate(date);
  } catch {
    errored = true;
  }
  return {
    date,
    today,
    prevDate: shiftDate(date, -1),
    nextDate: shiftDate(date, 1),
    strip: buildDateStrip(date, 7, today),
    response,
    errored,
  };
}

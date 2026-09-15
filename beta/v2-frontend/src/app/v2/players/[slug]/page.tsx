import { notFound } from 'next/navigation';
import { fetchPlayer } from '@/lib/v2/api';
import { idFromParam } from '@/lib/v2/slug';
import { routes } from '@/lib/v2/routes';
import { Breadcrumb } from '@/components/v2/nav';
import {
  PlayerIdentityHeader, PlayerAvailabilityPanel, PlayerStatisticsPanel,
  PlayerMatchHistory, PlayerValuationPanel, PlayerCoverage,
} from '@/components/v2/player';

export const dynamic = 'force-dynamic';

export default async function V2PlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Public URL is {player.slug}-{id}; the trailing DB id is the sole resolver.
  const playerId = idFromParam(slug);
  if (playerId === null) notFound();

  const data = await fetchPlayer(String(playerId));
  if (!data) notFound();
  const { player, currentTeam, competition, registration, availability, valuation, statistics } = data;

  return (
    <main className="space-y-5 mx-auto w-full max-w-6xl px-4 py-4">
      <Breadcrumb items={[{ label: 'Players', href: routes.players() }, { label: player.fullName }]} />

      {/* IDENTITY + team/competition/edition context (date of birth verbatim — age is not computed) */}
      <PlayerIdentityHeader player={player} currentTeam={currentTeam} competition={competition} registration={registration} />

      {/* CONTEXT / EVIDENCE */}
      <PlayerAvailabilityPanel availability={availability} />
      <PlayerStatisticsPanel statistics={statistics} />
      <PlayerMatchHistory recentMatches={statistics.recentMatches} currentTeam={currentTeam} />
      <PlayerValuationPanel valuation={valuation} />
      <PlayerCoverage data={data} />
    </main>
  );
}

import { Stub } from "@/components/Stub";
export const metadata = { title: "Watchlist" };
export default function WatchlistPage() {
  return (
    <Stub
      title="Watchlist"
      purpose="Saved teams, matches and leagues, with their intelligence changes surfaced as they move."
      needs={[
        "A persistence layer — there is no watchlist table in the schema, and no authentication to key one against.",
        "A change feed: intelligence shifts are computed per run but nothing records what changed between runs.",
      ]}
      instead={{ label: "Browse the match board", href: "/matches" }}
    />
  );
}

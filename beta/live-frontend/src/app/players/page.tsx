import { Stub } from "@/components/Stub";
export const metadata = { title: "Players" };
export default function PlayersPage() {
  return (
    <Stub
      title="Players"
      purpose="Player discovery across tracked squads — contribution, availability and form."
      needs={[
        "A player detail route. player_intelligence, player_season_statistics and player_versatility all hold data, but there is no /player/[slug] page for a listing to link into.",
        "A slug column on players, or a slug builder — the table has no slug and names are not unique across leagues.",
      ]}
      instead={{ label: "Players appear on each match page", href: "/matches" }}
    />
  );
}

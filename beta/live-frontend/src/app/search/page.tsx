import { Stub } from "@/components/Stub";
export const metadata = { title: "Search" };
export default function SearchPage() {
  return (
    <Stub
      title="Search"
      purpose="One search across matches, teams, players and leagues."
      needs={[
        "Text search across four tables. PostgREST can do ilike per table, but ranking results against each other needs either a materialised search view or Postgres full-text indexes, neither of which exists yet.",
        "The player route above, since players would be a quarter of the results.",
      ]}
      instead={{ label: "Team directory", href: "/teams" }}
    />
  );
}

import { redirect } from "next/navigation";

// Root entry. During migration the V2 surfaces live under /v2/* (a faithful
// re-home of the routes that previously lived inside the legacy frontend). The
// final cutover — when this app owns the root domain — will flatten /v2/* to the
// root and remove this redirect. Until then, root points at the live V2 index.
export default function Home() {
  redirect("/v2");
}

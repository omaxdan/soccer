import { redirect } from "next/navigation";
import { routes } from "@/lib/v2/routes";

// Root entry. During migration the V2 surfaces live under /v2/* (a faithful
// re-home of the routes that previously lived inside the legacy frontend). The
// final cutover — when this app owns the root domain — flips V2_BASE to '' so
// routes.leagues() becomes '/', and this redirect becomes a no-op self-reference to
// remove. Until then, root points at the live V2 index via the route helper (no
// hardcoded namespace).
export default function Home() {
  redirect(routes.leagues());
}

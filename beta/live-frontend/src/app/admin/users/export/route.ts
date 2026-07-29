import { NextResponse, type NextRequest } from "next/server";
import { exportUsersCsv, type UserListFilters } from "@/lib/admin";

/**
 * A real GET download, not a Server Action pretending to be one — Server
 * Actions can't set Content-Disposition or stream a file response, so the
 * export button links here directly instead of posting through an action.
 * exportUsersCsv() itself re-checks admin role and re-runs listUsers() under
 * RLS, so a forged request to this URL gets nothing back either way.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filters: UserListFilters = {
    q: searchParams.get("q") ?? undefined,
    role: searchParams.get("role") ?? undefined,
    plan: searchParams.get("plan") ?? undefined,
    provider: searchParams.get("provider") ?? undefined,
    status: (searchParams.get("status") as "active" | "suspended" | null) ?? undefined,
  };
  const csv = await exportUsersCsv(filters);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pitchterminal-users-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

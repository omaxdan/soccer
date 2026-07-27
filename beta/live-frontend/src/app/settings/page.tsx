import { Stub } from "@/components/Stub";
export const metadata = { title: "Settings" };
export default function SettingsPage() {
  return (
    <Stub
      title="Settings"
      purpose="Account preferences."
      needs={[
        "Authentication. There is no user table, no session, and nothing to attach a preference to.",
      ]}
      instead={{ label: "See plans", href: "/pricing" }}
    />
  );
}

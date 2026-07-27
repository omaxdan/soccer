import { signOut } from "@/lib/authActions";

export const metadata = { title: "Sign out" };

export default function LogoutPage() {
  return (
    <div className="mx-auto max-w-sm">
      <form action={signOut} className="panel p-5 text-center">
        <h1 className="mono text-[0.85rem] font-semibold uppercase tracking-[0.16em] text-text">
          Sign out
        </h1>
        <p className="mt-2 text-[0.74rem] text-muted">End this session on the terminal.</p>
        <button
          type="submit"
          className="mono mt-4 w-full rounded-term py-2 text-[0.68rem] font-semibold tracking-widest"
          style={{ color: "var(--ink)", background: "var(--amber)" }}
        >
          SIGN OUT
        </button>
      </form>
    </div>
  );
}

import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { signIn } from "@/lib/authActions";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthForm
      action={signIn}
      title="Sign in"
      submitLabel="SIGN IN"
      footer={
        <>
          No account?{" "}
          <Link href="/signup" className="text-amber underline underline-offset-2">
            Create one
          </Link>
        </>
      }
    />
  );
}

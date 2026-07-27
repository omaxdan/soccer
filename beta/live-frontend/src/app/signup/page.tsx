import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";
import { signUp } from "@/lib/authActions";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <AuthForm
      action={signUp}
      title="Create account"
      submitLabel="CREATE ACCOUNT"
      footer={
        <>
          Already registered?{" "}
          <Link href="/login" className="text-amber underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    />
  );
}

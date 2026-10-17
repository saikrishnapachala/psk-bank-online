import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/session";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="login">
      <h1>Sign in to PSK Bank Online</h1>
      <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
        Demo environment. The demo password is in <code>web/.env.local</code>. In production this screen hands off to your
        identity provider with MFA.
      </p>
      <LoginForm hintUser={process.env.DEMO_USERNAME ?? "alex"} />
    </main>
  );
}

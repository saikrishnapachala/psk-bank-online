import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { LoginForm } from "@/components/LoginForm";
import { getSession } from "@/lib/session";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  return (
    <main className="login-split">
      <section className="login-brand" aria-label="PSK Bank Online">
        <Logo light size={40} />
        <div>
          <h2>Savings, CDs and home loans, in one place.</h2>
          <p>Check balances, see every transaction and move money between your accounts.</p>
        </div>
        <p className="login-fine">Demo environment. Not a real bank; sandbox data only.</p>
      </section>
      <section className="login">
        <h1>Sign in</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
          Demo customers: <b>alex</b>, <b>jordan</b> and <b>sam</b>, password in <code>web/.env.local</code> (also
          listed under Debug › Test accounts). Sign in as a different customer on each laptop and send money between
          them. In production this screen hands off to your identity
          provider with MFA.
        </p>
        <LoginForm hintUser={process.env.DEMO_USERNAME ?? "alex"} />
      </section>
    </main>
  );
}

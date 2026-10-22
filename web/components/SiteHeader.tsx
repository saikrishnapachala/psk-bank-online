import Link from "next/link";
import { Logo } from "./Logo";
import { SignOutButton } from "./SignOutButton";

export function SiteHeader({ name, current }: { name: string; current: "accounts" | "move-money" | "debug" }) {
  return (
    <header className="site-header">
      <div className="utility">
        <div className="wrap">
          <span>Demo environment. Not a real bank; sandbox data only.</span>
          <span className="secure">Secure session</span>
        </div>
      </div>
      <div className="wrap main-bar">
        <Link href="/" className="brand" aria-label="PSK Bank Online home">
          <Logo />
        </Link>
        <nav className="nav" aria-label="Main">
          <Link href="/" aria-current={current === "accounts" ? "page" : undefined}>Accounts</Link>
          <Link href="/move-money" aria-current={current === "move-money" ? "page" : undefined}>Move money</Link>
          <Link href="/debug" aria-current={current === "debug" ? "page" : undefined}>Debug</Link>
        </nav>
        <div className="who">
          <span>{name}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

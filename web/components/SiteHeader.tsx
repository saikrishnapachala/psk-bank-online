import Link from "next/link";
import { SignOutButton } from "./SignOutButton";

export function SiteHeader({ name, current }: { name: string; current: "accounts" | "move-money" }) {
  return (
    <header className="site-header">
      <div className="wrap">
        <Link href="/" className="brand">
          PSK Bank Online <small>demo</small>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link href="/" aria-current={current === "accounts" ? "page" : undefined}>Accounts</Link>
          <Link href="/move-money" aria-current={current === "move-money" ? "page" : undefined}>Move money</Link>
        </nav>
        <div className="who">
          <span>{name}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

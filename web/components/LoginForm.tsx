"use client";

import { useState } from "react";

export function LoginForm({ hintUser }: { hintUser: string }) {
  const [username, setUsername] = useState(hintUser);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const json = await res.json().catch(() => ({}));
    setError(json?.error?.message ?? "Sign-in failed");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="panel">
      <label className="field">
        Username
        <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      </label>
      <label className="field">
        Password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button className="btn" disabled={busy || !username || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {error && <p className="notice bad result" role="alert">{error}</p>}
    </form>
  );
}

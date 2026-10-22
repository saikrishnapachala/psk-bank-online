"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Re-renders the server page every 2s so new hops show up while the team clicks around in another tab. */
export function LiveToggle() {
  const router = useRouter();
  const [live, setLive] = useState(true);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [live, router]);
  return (
    <button className="btn quiet" onClick={() => setLive(!live)} aria-pressed={live}>
      {live ? "Pause live updates" : "Resume live updates"}
    </button>
  );
}

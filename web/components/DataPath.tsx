import { health } from "@/lib/backend";
import { OutageToggle } from "./OutageToggle";

/** Shows which layers served this page and whether each provider is mock or live. For team demos. */
export async function DataPath() {
  const h = await health();
  const javaDown = !h;
  const fiservDown = !!h?.fiservCircuitOpen;
  return (
    <footer className="data-path" aria-label="How this page was served">
      <div className="wrap">
        <span>This page came from</span>
        <ol className="path">
          <li><span className="hop">Browser</span></li>
          <li><span className="hop">Next.js BFF</span></li>
          <li><span className={`hop ${javaDown ? "down" : ""}`}>Java service{javaDown && <span className="mode">unreachable</span>}</span></li>
          <li>
            <span className={`hop ${fiservDown ? "down" : ""}`}>
              Fiserv Banking Hub
              <span className={`mode ${h?.fiserv === "live" ? "live" : ""}`}>{fiservDown ? "circuit open" : h?.fiserv ?? "?"}</span>
            </span>
            <span className="hop">
              Plaid<span className={`mode ${h?.plaid === "live" ? "live" : ""}`}>{h?.plaid ?? "?"}</span>
            </span>
          </li>
        </ol>
        {h?.fiserv === "mock" && (
          <div className="controls">
            <OutageToggle on={fiservDown} />
          </div>
        )}
      </div>
    </footer>
  );
}

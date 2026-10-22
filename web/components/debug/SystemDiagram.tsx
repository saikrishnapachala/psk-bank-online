/** Architecture at a glance: who talks to whom, over what, and what each layer is trusted with. */

type Box = { x: number; y: number; w: number; h: number; title: string; lines: string[]; tone: string };

const BOXES: Box[] = [
  { x: 22, y: 120, w: 160, h: 130, title: "Browser", tone: "web", lines: ["React pages", "Holds no tokens", "Sees opaque ids", "and masked numbers"] },
  { x: 282, y: 120, w: 180, h: 130, title: "Next.js BFF", tone: "bff", lines: ["Session cookie", "CSRF + origin check", "Field whitelist", "Server-renders pages"] },
  { x: 572, y: 120, w: 200, h: 130, title: "Java banking service", tone: "java", lines: ["Entitlements", "Limits + idempotency", "Audit + circuit breaker", "Holds Fiserv/Plaid keys"] },
  { x: 880, y: 50, w: 180, h: 120, title: "Fiserv Banking Hub", tone: "fiserv", lines: ["EFX APIs → Premier", "System of record", "Balances, history,", "transfers"] },
  { x: 880, y: 220, w: 180, h: 110, title: "Plaid", tone: "plaid", lines: ["External bank link", "Balances + ACH auth", "(mock in this demo)"] },
];

const ARROWS = [
  { d: "M182 200 H282", label: ["HTTPS", "cookie + CSRF"], lx: 232, ly: 170 },
  { d: "M462 200 H572", label: ["private REST", "shared secret"], lx: 517, ly: 170 },
  { d: "M772 160 C826 160 826 110 880 110", label: ["OAuth token", "+ EFXHeader"], lx: 826, ly: 82 },
  { d: "M772 220 C826 220 826 275 880 275", label: ["client id", "+ secret"], lx: 826, ly: 300 },
];

export function SystemDiagram() {
  return (
    <figure className="diagram">
      <svg viewBox="0 0 1080 370" role="img" aria-labelledby="sysdiag-title sysdiag-desc">
        <title id="sysdiag-title">PSK Bank Online architecture</title>
        <desc id="sysdiag-desc">
          The browser talks only to the Next.js BFF. The BFF talks only to the Java banking service. Only Java calls
          Fiserv Banking Hub and Plaid, and only Java holds their credentials.
        </desc>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" className="dg-arrowhead" />
          </marker>
        </defs>

        {/* trust zones */}
        <rect x="8" y="16" width="188" height="340" rx="12" className="dg-zone" />
        <text x="20" y="40" className="dg-zone-label">Customer device</text>
        <rect x="262" y="16" width="530" height="340" rx="12" className="dg-zone dg-zone-ours" />
        <text x="276" y="40" className="dg-zone-label">PSK Bank servers (private network)</text>
        <rect x="864" y="16" width="208" height="340" rx="12" className="dg-zone" />
        <text x="878" y="40" className="dg-zone-label">Providers</text>

        {ARROWS.map((a, i) => (
          <g key={i}>
            <path d={a.d} className="dg-line" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
            <text x={a.lx} y={a.ly} textAnchor="middle" className="dg-label">
              {a.label.map((l, j) => <tspan key={j} x={a.lx} dy={j ? 13 : 0}>{l}</tspan>)}
            </text>
          </g>
        ))}

        {BOXES.map((b) => (
          <g key={b.title}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="10" className={`dg-box dg-${b.tone}`} />
            <text x={b.x + 14} y={b.y + 26} className="dg-title">{b.title}</text>
            {b.lines.map((l, i) => (
              <text key={l} x={b.x + 14} y={b.y + 50 + i * 18} className="dg-text">{l}</text>
            ))}
          </g>
        ))}

        <text x="527" y="300" textAnchor="middle" className="dg-note">One request id (X-Request-Id) follows every hop → Debug › Logs</text>
      </svg>
    </figure>
  );
}

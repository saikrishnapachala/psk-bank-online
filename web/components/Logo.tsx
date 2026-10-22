/**
 * PSK Bank mark: a red tile with a white "P" whose bowl is a vault door (ring plus a single bolt).
 * Original artwork; `light` is for use on black backgrounds.
 */
export function LogoMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <rect width="32" height="32" rx="7" fill="#EB0A1E" />
      <path d="M9 25V7h7.5a6.5 6.5 0 0 1 0 13H13" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16.4" cy="13.5" r="1.9" fill="#fff" />
    </svg>
  );
}

export function Logo({ light = false, size = 32 }: { light?: boolean; size?: number }) {
  return (
    <span className={`logo${light ? " logo-light" : ""}`}>
      <LogoMark size={size} />
      <span className="logo-word">
        <b>PSK Bank</b>
        <span>Online</span>
      </span>
    </span>
  );
}

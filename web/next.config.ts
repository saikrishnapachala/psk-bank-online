import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Plaid Link loads from cdn.plaid.com and opens an iframe; everything else is same-origin.
// The browser never calls Fiserv or the Java service directly.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.plaid.com",
  "frame-src https://cdn.plaid.com",
  "connect-src 'self' https://*.plaid.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: lets a second computer on the same Wi-Fi open http://<this-mac-ip>:3000 for the two-customer demo.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    if (isProd) {
      headers.push({ key: "Content-Security-Policy", value: csp });
      headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
    }
    return [{ source: "/:path*", headers }];
  },
};

export default nextConfig;

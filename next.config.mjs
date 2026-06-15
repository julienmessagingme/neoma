// En-têtes de sécurité appliqués à toutes les routes. Durcissement
// defense-in-depth : anti-clickjacking (X-Frame-Options + CSP frame-ancestors),
// HTTPS forcé (HSTS), anti-MIME-sniffing, fuite de referer limitée. Pas de CSP
// script-src ici (romprait les scripts inline de Next) — à ajouter via un pass
// dédié si besoin. includeSubDomains sans `preload` (pas de soumission au
// preload-list). frame-ancestors 'none' n'affecte que l'embarquement en iframe.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // N'expose pas la stack (`x-powered-by: Next.js`).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // node-cron uses worker_threads + Node's stream API which webpack can't
  // bundle. Mark it as external so Node requires it natively at runtime.
  serverExternalPackages: ["node-cron"],
  // The standalone tracer can't see our hidden createRequire('node-cron'),
  // so it doesn't copy it into the standalone bundle. Force its inclusion
  // (and its dependency luxon) so production runtime can resolve it.
  outputFileTracingIncludes: {
    "/": ["./node_modules/node-cron/**", "./node_modules/luxon/**"],
  },
  experimental: {
    optimizePackageImports: ["recharts", "date-fns", "lucide-react", "@supabase/supabase-js"],
  },
};

export default nextConfig;

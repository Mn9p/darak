import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { resolve } from "node:path";
import { PrismaPlugin } from "@prisma/nextjs-monorepo-workaround-plugin";

// Monorepo: the single .env lives at the repo root (also read by packages/db scripts).
loadEnvConfig(resolve(__dirname, "../.."), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error }, true);

const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy is set per request with a nonce in src/middleware.ts.

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
  // Monorepo: trace files from the repo root so standalone output includes workspace packages.
  outputFileTracingRoot: resolve(__dirname, "../.."),
  // NEXT_DIST_DIR lets CI/verification builds run while `next dev` holds .next
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  // The dev "N" badge sits on top of the phone bottom bar; build errors still show their overlay.
  devIndicators: false,
  transpilePackages: ["@darak/db"],
  serverExternalPackages: ["@prisma/client"],
  reactStrictMode: true,
  // Uploads: 20 MB files (lib/storage MAX_FILE_BYTES) + form overhead. Vercel caps request bodies at 4.5 MB regardless (see storage).
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  // Monorepo + pnpm: @prisma/client resolves from packages/db, so Next bundles it and the query engine is not traced into the
  // serverless functions. Prisma's plugin copies the engine and schema next to the server chunks (docs: prisma nextjs monorepo).
  webpack: (config, { isServer }) => {
    if (isServer) config.plugins = [...config.plugins, new PrismaPlugin()];
    return config;
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

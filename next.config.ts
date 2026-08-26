import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { NextConfig } from "next";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
const proxyClientMaxBodySize = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite", "open"],
  turbopack: {
    root: tracingRoot,
    resolveAlias: {
      'open-sse': './src/lib/open-sse',
    },
  },
  outputFileTracingRoot: tracingRoot,
  outputFileTracingExcludes: {
    "*": ["./gitbook/**/*"]
  },
  images: {
    unoptimized: false,
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
  env: {},
  serverComponentsHmrCache: true,
  experimental: {
    proxyClientMaxBodySize: proxyClientMaxBodySize as any,
    optimizePackageImports: ["@xyflow/react", "@dnd-kit/core", "@dnd-kit/sortable", "material-symbols", "marked"],
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      aggregateTimeout: 300,
      ignored: /[\\/](node_modules|\.git|logs|\.next|\.next-cli-build|gitbook|cli|open-sse\.old|tests|docs|AppData[\\/]Local[\\/]Intel)[\\/]/,
    };
    return config;
  },
  async rewrites() {
    return [
      { source: "/v1/v1/:path*", destination: "/api/v1/:path*" },
      { source: "/v1/v1", destination: "/api/v1" },
      { source: "/codex/:path*", destination: "/api/v1/responses" },
      { source: "/responses", destination: "/api/v1/responses" },
      { source: "/v1beta/:path*", destination: "/api/v1beta/:path*" },
      { source: "/v1beta", destination: "/api/v1beta" },
      { source: "/v1/:path*", destination: "/api/v1/:path*" },
      { source: "/v1", destination: "/api/v1" }
    ];
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  poweredByHeader: false,
};

export default nextConfig;

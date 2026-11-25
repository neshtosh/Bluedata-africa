import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  // Overridable so e2e dev servers don't share .next with a developer's running dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Self-contained server bundle for the Docker image (infra/docker/web.Dockerfile). The tracing
  // root is the monorepo, so workspace packages are included.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;

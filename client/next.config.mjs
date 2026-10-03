import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets a concurrently-running instance (e.g. the hermetic e2e stack in
  // scripts/e2e.sh) build into its own directory instead of colliding with a
  // dev server's .next — two `next dev` processes sharing one .next corrupt
  // each other's compiled chunks (an NEXT_PUBLIC_* env value from whichever
  // process compiled last leaks into the other's served bundle).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
};

export default withNextIntl(nextConfig);

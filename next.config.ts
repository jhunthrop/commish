import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay bubble sits exactly where the draft room's dock puts its
  // "you're up in N picks" line; errors still surface in the terminal and console.
  devIndicators: false,
  // A `next dev` process can be running against this same checkout at the same time as an
  // e2e `next build`/`next start` (both default to `.next`); `next dev` keeps writing HMR
  // chunks into it, which corrupts the production build's asset manifest out from under a
  // `next start` that shares the directory. `NEXT_DIST_DIR` (unset by default, so `next dev`
  // is untouched) lets `playwright.config.ts` point its build/start at an isolated `.next-e2e`.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;

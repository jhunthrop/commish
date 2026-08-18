import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev overlay bubble sits exactly where the draft room's dock puts its
  // "you're up in N picks" line; errors still surface in the terminal and console.
  devIndicators: false,
};

export default nextConfig;

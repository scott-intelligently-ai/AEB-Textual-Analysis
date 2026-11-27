import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs reads Node built-ins. Leaving it external keeps the download route from bundling them.
  serverExternalPackages: ["exceljs"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

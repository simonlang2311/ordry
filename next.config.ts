import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    serverActions: {
      // Hier erlauben wir den Zugriff über den Tunnel
      allowedOrigins: [
        "0rv8m53l-3000.euw.devtunnels.ms", 
        "localhost:3000"
      ],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
<<<<<<< HEAD
=======

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
>>>>>>> 855c9c3b67d0413eaeda37ccd9e649bb72c5cc41

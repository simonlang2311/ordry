import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: true,
  devIndicators: false,
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

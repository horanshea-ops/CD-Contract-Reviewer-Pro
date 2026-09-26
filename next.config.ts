import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The sign-in proxy buffers each request body, and cuts it at 10MB by
    // default. Uploads allow 32MB, plus room for the form fields around the file.
    proxyClientMaxBodySize: "33mb",
  },
};

export default nextConfig;

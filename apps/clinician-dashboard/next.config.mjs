import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@medflow/ui", "@medflow/shared-types", "@medflow/fhir-types"],
  experimental: {},
  webpack: (config) => {
    // Cornerstone DICOM image loader ships a wasm codec build; avoid bundling
    // the optional node-only "fs" path on the client.
    config.resolve = config.resolve || {};
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    return config;
  },
};

export default withNextIntl(nextConfig);

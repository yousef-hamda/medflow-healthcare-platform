import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@medflow/ui", "@medflow/shared-types", "@medflow/fhir-types"],
};

export default withNextIntl(nextConfig);

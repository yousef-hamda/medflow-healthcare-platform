import type { Config } from "tailwindcss";

const config: Config = {
  presets: [require("@medflow/ui/tailwind-preset")],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;

/* eslint-env node */
module.exports = {
  root: true,
  extends: ["expo", "prettier"],
  rules: {
    // PHI must never hit the console — use the redacting logger (src/lib/logger.ts).
    "no-console": "error",
  },
  overrides: [
    {
      files: ["src/lib/logger.ts"],
      rules: { "no-console": "off" },
    },
    {
      files: ["**/*.test.ts", "**/*.test.tsx", "jest.setup.js"],
      env: { jest: true },
      rules: { "no-console": "off" },
    },
    {
      files: ["*.config.js", "*.config.ts", ".eslintrc.cjs", "babel.config.js", "metro.config.js"],
      env: { node: true },
    },
  ],
  ignorePatterns: ["node_modules", ".expo", "dist", "android", "ios", "coverage"],
};

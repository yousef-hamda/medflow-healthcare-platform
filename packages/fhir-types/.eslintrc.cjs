/** ESLint config for @medflow/fhir-types. */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { project: "./tsconfig.json", sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  env: { node: true, es2022: true },
  ignorePatterns: ["dist", "*.cjs", "tsup.config.ts", "vitest.config.ts"],
  rules: {
    "@typescript-eslint/no-explicit-any": "error"
  },
};

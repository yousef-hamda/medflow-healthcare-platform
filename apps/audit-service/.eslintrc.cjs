"use strict";

/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ],
  rules: {
    // Enforce no `any` — PHI audit code must be fully typed
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/no-unsafe-argument": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
    "no-console": "warn",
  },
  env: {
    node: true,
    es2022: true,
  },
};

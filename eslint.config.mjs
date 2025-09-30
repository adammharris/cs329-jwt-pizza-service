import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    // include common environment globals (node + browser) for general files
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // enable jest globals for test files
  {
    files: ["**/*.test.js", "**/__tests__/**"],
    languageOptions: { globals: { ...globals.jest, ...globals.node } },
  },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
]);

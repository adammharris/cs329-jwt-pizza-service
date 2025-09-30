import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import jest;

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: { globals: globals.browser },
    ...jest.configs["flat/recommended"],
  },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
]);

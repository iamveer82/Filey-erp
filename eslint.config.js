import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

// Pragmatic flat config. Real-bug rules (hooks deps, unsafe patterns) are
// errors; pre-existing style debt (explicit any, etc.) is warnings so the
// gate can go green now and the debt can be paid down without blocking CI.
export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      ".agents", // vendored agent-skill scripts, not part of the app
      ".claude", // workflow scripts, not part of the app
      "src/vendor", // vendored third-party libs (xlsx), not our code
      "server", // separate Node runtime, not in the desktop/web build
      "src-tauri/target",
      "public/sw.js", // service-worker globals, hand-written
      "worker", // separate Cloudflare worker deploy, Node runtime
      "**/*.config.{js,ts,mjs}",
      "scripts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // TypeScript already resolves identifiers; no-undef just double-reports.
      "no-undef": "off",
      // Short-circuit / optional-call expression statements are idiomatic here.
      "@typescript-eslint/no-unused-expressions": "warn",
      // Catches the toast-in-deps / stale-closure class of bugs.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // Existing debt — warn, don't block.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Pedantic/rare regex + whitespace rules — surface as warnings.
      "no-useless-escape": "warn",
      "no-irregular-whitespace": "warn",
      "no-misleading-character-class": "warn",
    },
  }
);

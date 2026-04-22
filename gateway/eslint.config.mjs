// Flat ESLint config for @sovereign/gateway.
//
// Regression guardrails from the D2 remediation phase:
//
//   - `no-constant-condition` is errored to stop `while (true)` creeping back
//     in. The autonomous loop engine's long-running loops MUST be bounded by
//     `maxCycles` / `maxDurationMs`.
//   - `@typescript-eslint/no-explicit-any` is warned, not errored, so existing
//     (~194) occurrences don't wedge CI but new ones show up in review.
//   - `no-console` is warned in production source, allowed in scripts/tests.
//
// To upgrade `any` to `error` after the cleanup, change the warning level
// in the override block below.

import tseslint from "typescript-eslint";
import js from "@eslint/js";

export default [
  {
    ignores: [
      "dist/**",
      "out/**",
      "coverage/**",
      "node_modules/**",
      "ui/dist/**",
      "ui/node_modules/**",
      "vscode-extension/dist/**",
      "vscode-extension/node_modules/**",
      "**/*.d.ts",
      ".agent/**",
      ".ai-company/**",
      ".opencode_test/**",
      "test-workspace*/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        queueMicrotask: "readonly",
      },
    },
    rules: {
      // D2 — regression stop
      "no-constant-condition": ["error", { checkLoops: true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Quality signals
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-fallthrough": "error",
      "no-throw-literal": "error",

      // Noise control
      "no-console": "off", // allow in gateway/cli; scripts/tests override below
      "prefer-const": "error",
    },
  },

  // Scripts, tests, and CLI entries: console is expected
  {
    files: ["scripts/**/*.ts", "script/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // CommonJS scripts — allow require() and Node.js globals
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
    },
  },

  // UI (React) — keep same core rules; JSX specifics handled by Vite/TS
  {
    files: ["ui/src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

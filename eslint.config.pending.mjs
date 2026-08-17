// PENDING: eslint.config.mjs is hook-protected in this session (config-protection hook
// needs a session restart to pick up .claude/settings.json's ECC_DISABLED_HOOKS).
// After restarting, apply this diff to eslint.config.mjs, then delete this file.
//
// 1. Add imports at the top:
//      import jsxA11y from "eslint-plugin-jsx-a11y";
//      import functional from "eslint-plugin-functional";
//
// 2. Add these two entries to the eslintConfig array, after the "ignores" block:

export const pendingRules = [
  {
    // Domain types must be immutable (readonly) — user's global coding-style rule.
    files: ["src/domain/**/*.ts"],
    plugins: { functional: "functional" },
    rules: {
      "functional/prefer-readonly-type": "error",
      "functional/immutable-data": "error",
      "functional/no-let": "error",
    },
  },
  {
    // Accessibility baseline — WCAG 2.2 AA per the design-system foundation.
    files: ["src/**/*.tsx"],
    plugins: { "jsx-a11y": "jsxA11y" },
    rules: {
      // spread jsxA11y.flatConfigs.strict.rules
    },
  },
];

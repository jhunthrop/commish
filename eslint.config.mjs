import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "@typescript-eslint/eslint-plugin";
import jsxA11y from "eslint-plugin-jsx-a11y";
import functional from "eslint-plugin-functional";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Server-only modules the draft room's and the league room's client code must never import as
 * VALUES: the reducers/selectors, the league rules, the Postgres/Redis-backed store, the db
 * schema, the realtime transport internals, the WorkOS identity seam, the league
 * auth+membership seam, the destructive dev seeders, the LLM client, and the API envelope
 * module (which value-imports `NextResponse`) all live behind the API routes and the SSE
 * route, not in the browser bundle. `import type` stays allowed — sharing a TYPE (e.g.
 * `DraftStateView`, `LeagueSummary`, `ApiEnvelope`) costs nothing at runtime and is how the
 * client and server sides of the wire stay in sync; several client files already
 * `import type { ApiEnvelope } from "@/lib/api/respond"` and must keep working.
 *
 * `@/event-stream` is deliberately NOT on this list and must not be added to it: it is browser
 * code (one shared `EventSource` per league stream url, constructed lazily), it is what both
 * rooms' `deps.tsx` factories value-import, and nothing server-side imports it. That is also
 * why it is a top-level sibling rather than a child of `@/lib/realtime` — `aliasOrRelative`
 * below would match any `@/lib/realtime-…` or `@/lib/realtime/…` spelling and ban it.
 *
 * Only the bare module name is listed here — `aliasOrRelative` below turns each one into a
 * single `regex` pattern that matches BOTH the `@/` alias (`@/db`, `@/db/client`, any subpath)
 * AND the equivalent relative-path spelling (`../db`, `../../db/client`, …), which a plain
 * `group` glob list would not: every `group` entry here used to be anchored on `@/`, so
 * `import { x } from "../../draft-engine"` produced zero diagnostics — a real bypass, not a
 * gap anyone would need to reach for on purpose, but nothing stopped it either.
 */
const SERVER_ONLY_MODULE_GROUPS = [
  "@/draft-engine",
  "@/draft-service",
  "@/league",
  "@/league-service",
  // Both are Postgres-backed (`chat-service/chat.ts`, `ai-advisor/context.ts`) and were the
  // one-hop way around the `@/db` ban: a client file importing `@/chat-service` was legal to
  // this rule, while the `@/db` import that makes it server-only sat in a file the glob below
  // does not cover. `aliasOrRelative` anchors on the full segment, so banning `@/chat-service`
  // cannot catch the PURE `@/chat` (contract, config, folds) that `src/chat-room/**`
  // legitimately value-imports.
  "@/chat-service",
  "@/ai-advisor",
  "@/db",
  "@/lib/realtime",
  "@/lib/auth",
  "@/lib/leagues",
  "@/lib/llm",
  "@/lib/api/respond",
  "@/data/seed",
];

/**
 * One regex per module matching either spelling: `@/<module>` (optionally with a subpath) or
 * any number of leading `../`/`./` segments followed by `<module>` (optionally with a
 * subpath). A single regex per module rather than a `group` glob PLUS a `/*` sibling for deep
 * imports: `no-restricted-imports`'s `group` patterns already match with `ignore`'s gitignore
 * semantics, under which a bare `"@/db"` matches `"@/db/client"` on its own — a `/*` sibling
 * entry added no coverage there, only a second, duplicate error for the same import (verified
 * empirically before this rewrote the whole list as regexes instead).
 */
function aliasOrRelative(moduleWithAlias) {
  const bareName = moduleWithAlias.replace(/^@\//, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `^(?:@/|(?:\\.\\.?/)+)${bareName}(?:/|$)`;
}

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { files: ["src/**/*.tsx"], rules: { ...jsxA11y.flatConfigs.strict.rules } },
  {
    files: ["src/domain/**/*.ts"],
    plugins: { functional },
    rules: {
      "functional/prefer-readonly-type": "error",
      "functional/immutable-data": "error",
      "functional/no-let": "error",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // Isolated build output for the e2e suite (see next.config.ts, playwright.config.ts) —
      // generated the same way `.next/**` is, and just as much not source.
      ".next-e2e/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "coverage/**",
      ".claude/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    // Playwright fixtures/specs, not React: `e2e/support/fixtures.ts` destructures a second
    // fixture-function parameter literally named `use` (Playwright's own API, e.g.
    // `managerA: async ({ browser }, use) => { ... }`) which `react-hooks/rules-of-hooks`
    // otherwise flags as an unlawfully-named/placed React Hook call. Scoped to `e2e/**` only —
    // every other directory keeps the full `next/core-web-vitals` rule set.
    files: ["e2e/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  {
    // Scoped to src/draft-room/** and src/league-room/** ONLY, not src/app/**/*.tsx: files
    // under src/app are Next.js Server Components (page.tsx, layout.tsx, route.ts) that are
    // allowed — and in this codebase's existing route handlers, expected — to import
    // @/draft-engine/@/draft-service/@/league/@/league-service directly (see
    // docs/conventions.md, "Client boundary"). A page can't be told apart from a client
    // component by its filename alone, so the only globs that can't misfire are the three
    // directories that are BROWSER code by construction: everything under src/draft-room/**,
    // src/league-room/** and src/chat-room/**.
    files: ["src/draft-room/**/*.{ts,tsx}", "src/league-room/**/*.{ts,tsx}", "src/chat-room/**/*.{ts,tsx}"],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: SERVER_ONLY_MODULE_GROUPS.map((group) => ({
            regex: aliasOrRelative(group),
            allowTypeImports: true,
            message: "Client room code (draft-room/league-room/chat-room) must go through the HTTP/SSE boundary (API routes), not import server-only modules as values. `import type` is fine.",
          })),
        },
      ],
    },
  },
];

export default eslintConfig;

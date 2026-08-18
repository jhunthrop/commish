import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import tseslint from "@typescript-eslint/eslint-plugin";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Server-only modules the draft room's and the league room's client code must never import as
 * VALUES: the reducers/selectors, the league rules, the Postgres/Redis-backed store, the db
 * schema, and the realtime transport internals all live behind the API routes and the SSE
 * route, not in the browser bundle. `import type` stays allowed — sharing a TYPE (e.g.
 * `DraftStateView`, `LeagueSummary`) costs nothing at runtime and is how the client and server
 * sides of the wire stay in sync.
 *
 * Both the bare barrel specifier (`@/db`, `@/lib/realtime`) and a `/*` glob for deep imports
 * (`@/db/client`, `@/lib/realtime/sse`, …) are listed for every module — `@/draft-service` is
 * imported both ways elsewhere in the codebase (e.g. `@/draft-service` itself and
 * `@/draft-service/pool`), so a rule that only caught one form would be trivially bypassed by
 * reaching one level deeper.
 */
const SERVER_ONLY_MODULE_GROUPS = [
  "@/draft-engine",
  "@/draft-engine/*",
  "@/draft-service",
  "@/draft-service/*",
  "@/league",
  "@/league/*",
  "@/league-service",
  "@/league-service/*",
  "@/db",
  "@/db/*",
  "@/lib/realtime",
  "@/lib/realtime/*",
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "coverage/**",
      ".claude/**",
    ],
  },
  {
    // Scoped to src/draft-room/** and src/league-room/** ONLY, not src/app/**/*.tsx: files
    // under src/app are Next.js Server Components (page.tsx, layout.tsx, route.ts) that are
    // allowed — and in this codebase's existing route handlers, expected — to import
    // @/draft-engine/@/draft-service/@/league/@/league-service directly (see
    // docs/conventions.md, "Client boundary"). A page can't be told apart from a client
    // component by its filename alone, so the only globs that can't misfire are the two
    // directories that are BROWSER code by construction: everything under src/draft-room/**
    // and src/league-room/**.
    files: ["src/draft-room/**/*.{ts,tsx}", "src/league-room/**/*.{ts,tsx}"],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: SERVER_ONLY_MODULE_GROUPS.map((group) => ({
            group: [group],
            allowTypeImports: true,
            message: "Client draft-room/league-room code must go through the HTTP/SSE boundary (API routes), not import server-only modules as values. `import type` is fine.",
          })),
        },
      ],
    },
  },
];

export default eslintConfig;

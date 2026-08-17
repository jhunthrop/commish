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
 * Server-only modules the draft room's client code must never import as VALUES: the
 * reducer/selectors, the Postgres/Redis-backed store, the db schema, and the realtime
 * transport internals all live behind the API routes and the SSE route, not in the browser
 * bundle. `import type` stays allowed — sharing a TYPE (e.g. `DraftStateView`) costs nothing
 * at runtime and is how the client and server sides of the wire stay in sync.
 */
const SERVER_ONLY_MODULE_GROUPS = ["@/draft-engine", "@/draft-service", "@/db/*", "@/lib/realtime/*"];

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
    files: ["src/draft-room/**/*.{ts,tsx}", "src/app/**/*.tsx"],
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: SERVER_ONLY_MODULE_GROUPS.map((group) => ({
            group: [group],
            allowTypeImports: true,
            message: "Client draft-room code must go through the HTTP/SSE boundary (API routes), not import server-only modules as values. `import type` is fine.",
          })),
        },
      ],
    },
  },
];

export default eslintConfig;

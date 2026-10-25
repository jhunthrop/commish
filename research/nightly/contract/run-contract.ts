// THE RUN AGAINST THE WEB'S OWN READER (the nightly's `schema` gate, `research/nightly/schema_gate.py`).
//
// Every artifact of one run, read through the web build's own reader, `web/src/lib/server/run.ts`:
// the same module the build prerenders from, with its schemas (`src/lib/run/schema.ts`) and every
// cross-file check it makes (the manifest names its own run, the index matches the manifest, ids and
// slugs are unique, each format's board says it is that format, each page's log runs the schedule's
// weeks and its season is the index's two numbers for him, and `season-checks.ts` across the season
// blocks). Nothing here restates a check (fix round 2, N6): a check the web adds is gated the night
// the image carrying it deploys. A run this refuses is one the web build would refuse.
//
//   node --experimental-strip-types run-contract.ts <web dir> <runs root> <run id>
//
// <web dir> holds `src/lib/run/*.ts`, `src/lib/server/run.ts`, `src/lib/types/player.ts` and a
// node_modules with zod and aws4fetch (the web's own versions). The reader's one SvelteKit import,
// `$app/env/public` (the build's PUBLIC_RUN_ID and PUBLIC_RUN_BASE_URL), is answered here with the run
// to check. Every refusal is printed as one line, `schema:<file>:<message>`, and the exit status is 1
// when there is any, 2 when the checker itself could not run. A run with none prints its season reach
// as one line, `reach:<json>` (Lane 205), before the summary line.
//
// Lane 136: each player page the reader refuses is its own line, `schema:players/<id>.json:<message>`,
// and each held page's earlier copy it refuses `schema:held/<id>.json:<message>`, so the gate can hold
// a refused page back (research/nightly/held_pages.py) and fail the run on anything else. A run that
// holds pages (`held.json`) is read as the build reads it: a held page's own document is never read.
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [webDir, root, runId] = process.argv.slice(2);
if (!webDir || !root || !runId) {
  process.stderr.write(
    "usage: run-contract.ts <web dir> <runs root> <run id>\n",
  );
  process.exit(2);
}

const ENV_MODULE = "$app/env/public";
const envSource =
  `export const PUBLIC_RUN_ID = ${JSON.stringify(runId)};\n` +
  `export const PUBLIC_RUN_BASE_URL = ${JSON.stringify(resolve(root))};\n`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === ENV_MODULE) {
      return {
        url: `data:text/javascript,${encodeURIComponent(envSource)}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const web = await import(
  pathToFileURL(resolve(webDir, "src/lib/server/run.ts")).href
);

interface Entry {
  id: string;
}
interface Format {
  id: string;
}

const oneLine = (text: string): string => text.replaceAll("\n", " ");
/** The season reach's line, apart from the refusals (schema_gate.py `_REACH_PREFIX`). */
const REACH_PREFIX = "reach:";

// One line per refusal, named by the first file that met it: the reader shares one read per artifact,
// so a broken schedule refuses every page through the same error. The player pages the reader refuses
// come as one error naming each (Lane 136), and each is a line of its own, keyed by its file.
const refusals = new Map<string, string>();
let refusedPages = 0;
function refuse(error: unknown, file: string): void {
  if (error instanceof web.RefusedPages) {
    refusedPages = error.pages.size;
    for (const [where, named] of [
      ["players", error.pages],
      ["held", error.copies],
    ] as const) {
      for (const [id, message] of named) {
        const path = `${where}/${id}.json`;
        refusals.set(path, `schema:${path}:${oneLine(message)}`);
      }
    }
    return;
  }
  const message = oneLine(
    error instanceof Error ? error.message : String(error),
  );
  if (!refusals.has(message))
    refusals.set(message, `schema:${file}:${message}`);
}
async function check<T>(
  file: string,
  read: () => Promise<T>,
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    refuse(error, file);
    return null;
  }
}

const manifest = await check<{ formats: Format[] }>("manifest.json", () =>
  web.manifest(),
);
await check("manifest.json", () => web.stamp());
const index = await check<Entry[]>("index.json", () => web.index());
let rows = 0;
for (const format of manifest?.formats ?? []) {
  const board = await check<{ rows: unknown[]; market?: unknown[] }>(
    `boards/${format.id}.json`,
    () => web.board(format.id),
  );
  rows += (board?.rows.length ?? 0) + (board?.market?.length ?? 0);
}
const held = await check<Map<string, { copy: unknown }>>("held.json", () =>
  web.held(),
);
let pages = 0;
for (const entry of index ?? []) {
  // Labelled `players` alone: only the reader's own refusal of a page names that page's file, so a
  // failure every page meets (an unreadable schedule) is never taken for one page's.
  const read = await check<{ kind: string }>("players", () =>
    web.playerRead(entry.id),
  );
  if (read?.kind === "page") pages += 1;
}
// One error refuses every page's read, so the pages taken are those it does not name.
if (refusedPages > 0 && held)
  pages = (index?.length ?? 0) - held.size - refusedPages;
const copies = [...(held?.values() ?? [])].filter(
  (page) => page.copy !== null,
).length;
const heldWords =
  held && held.size > 0
    ? `, ${held.size} held (${copies} from an earlier run)`
    : "";
await check("adp.json", () => web.adp());
await check("record.json", () => web.record());
await check("clubs.json", () => web.clubs());
await check("schedule.json", () => web.schedule());
await check("designations.json", () => web.designations());
// The run-wide loaders the build's pages call (fix round 3, R5): each holds the run to a rule no single
// file carries (the season blocks' reach and format, the first kickoff, the default format).
for (const name of [
  "firstKickoff",
  "seasonUnderway",
  "seasonReach",
  "defaultFormat",
] as const) {
  if (typeof web[name] !== "function") {
    refusals.set(
      `missing ${name}`,
      `schema:run:the web reader exports no ${name}`,
    );
    continue;
  }
  await check("run", () => web[name]());
}
// Lane 205: the run's season reach, counted by the web's own runSeasonReach over the run just read, on
// one line `reach:<json>` that the gate writes into the final manifest. A run with any refusal has
// none: the gate writes no reach for a run it refuses.
const reach =
  refusals.size === 0
    ? await check("run", () => {
        if (typeof web.runSeasonReach !== "function")
          throw new Error("the web reader exports no runSeasonReach");
        return web.runSeasonReach();
      })
    : null;

for (const line of refusals.values()) process.stdout.write(`${line}\n`);
if (refusals.size === 0 && reach !== null)
  process.stdout.write(`${REACH_PREFIX}${JSON.stringify(reach)}\n`);
process.stdout.write(
  `run ${runId}: ${refusals.size} refusals; ${manifest?.formats.length ?? 0} formats (${rows} board rows), ` +
    `${pages} of ${index?.length ?? 0} player pages parsed${heldWords}, adp, record, clubs, schedule, designations\n`,
);
process.exit(refusals.size === 0 ? 0 : 1);

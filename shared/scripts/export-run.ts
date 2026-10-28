/** The web's fixture run as the bucket holds it, under shared/fixtures/run, for the API's run routes
 * test (api/internal/runs) and the apps: the nightly's contract fixture run the web's shots build
 * from (CONTRACT_RUN_ID, web/scripts/inseason-fixture/run-ids.ts): its PPR board, its index, its
 * ADP, every player's page, its record, its clubs and its schedule exactly as written
 * (Lane 188 added the pages, the record, the clubs and the schedule), the manifest with the season
 * reach the nightly writes into it (Lane 205), the latest pointer naming it, and its designations: the
 * stand-in's injury capture (web/scripts/standin-designations.json) held to the players the run
 * indexes, the way the stand-in writes a run's designations. README.md, written beside them, lists
 * each file with the route that answers it.
 *
 *   node shared/scripts/export-run.ts */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runReach } from "../../web/src/lib/run/reach.ts";
import { buildReads } from "../../web/src/lib/run/reads.ts";
import {
  RUN_PATHS,
  manifestSchema,
  playerSchema,
  scheduleSchema,
  type RunReach,
} from "../../web/src/lib/run/schema.ts";
import {
  REPOSITORY,
  generatedBy,
  writeOutputs,
  type Outputs,
} from "./generated.ts";

const SCRIPT = "shared/scripts/export-run.ts";
/** The fixture run's folder: the bucket's layout, `runs/latest.json` and `runs/<runId>/`. */
export const RUN_FIXTURE = "shared/fixtures/run";
/** The branch build's run (Lane 252, B259): the same run with every file a build reads
 * (web/src/lib/run/reads.ts), every format's board among them, so a branch builds and measures the
 * site with no secret. Apart from RUN_FIXTURE, whose one board the apps' tests read as a run that
 * lacks the other formats. */
export const BUILD_RUN_FIXTURE = "shared/fixtures/build-run";
const RUN_IDS = "web/scripts/inseason-fixture/run-ids.ts";
const CONTRACT_RUNS = "research/nightly/contract/fixture/runs";
const DESIGNATIONS = "web/scripts/standin-designations.json";
/** The PPR board's format id, the default the manifest lists first. */
export const PPR_FORMAT = "ppr-12";
/** The kickers' and defenses' orderBasis in the index: no page of their own. */
const MARKET_BASIS = "market";
/** The run's files copied byte for byte, every player's page among them; the manifest is copied with
 * the season reach the nightly writes into it (withReach). */
function copiedFiles(players: readonly string[]): string[] {
  return [
    `boards/${PPR_FORMAT}.json`,
    "index.json",
    "adp.json",
    ...players.map(playerPath),
    "record.json",
    "clubs.json",
    "schedule.json",
  ];
}

const playerPath = (id: string): string => `players/${id}.json`;

/** Every player the index gives a page: each entry but a kicker's or a defense's, in its order. */
export function pageIds(index: readonly unknown[]): string[] {
  return index.flatMap((entry) => {
    const { id, orderBasis } = entry as { id?: unknown; orderBasis?: unknown };
    if (typeof id !== "string") throw new Error("An index entry has no id.");
    return orderBasis === MARKET_BASIS ? [] : [id];
  });
}

/** A file of the fixture, the route the API answers it on (null for the pointer), and what it holds. */
export interface RunFile {
  path: string;
  route: string | null;
  about: string;
}

/** The files the fixture carries, each where the run writes it in the bucket. */
export function runFiles(runId: string, players: readonly string[]): RunFile[] {
  const at = (path: string): string => `runs/${runId}/${path}`;
  return [
    {
      path: "runs/latest.json",
      route: null,
      about: "the latest pointer, naming the fixture run",
    },
    {
      path: at("manifest.json"),
      route: "GET /run/manifest",
      about:
        "the run: its formats, its players, its sources and its season reach",
    },
    {
      path: at(`boards/${PPR_FORMAT}.json`),
      route: `GET /run/boards/${PPR_FORMAT}`,
      about: "the PPR board, every row as written",
    },
    {
      path: at("index.json"),
      route: "GET /run/index",
      about: "every player with his season so far",
    },
    {
      path: at("adp.json"),
      route: "GET /run/adp",
      about: "every ADP source and its value per player",
    },
    {
      path: at("designations.json"),
      route: "GET /run/designations",
      about: "the stand-in's injury capture, held to the run's players",
    },
    ...players.map((id) => ({
      path: at(playerPath(id)),
      route: `GET /run/players/${id}`,
      about:
        "his page: every format that ranks him, the capsule and his season so far",
    })),
    {
      path: at("record.json"),
      route: "GET /run/record",
      about: "the record: every week of the season and the season to date",
    },
    {
      path: at("clubs.json"),
      route: "GET /run/clubs",
      about: "the 32 clubs with their names and byes",
    },
    {
      path: at("schedule.json"),
      route: "GET /run/schedule",
      about: "every club's slate and its strength",
    },
  ];
}

interface Capture {
  players: Record<string, unknown>;
}

/** The capture with only the players the index names, in the capture's own order. */
export function heldToIndex(
  capture: Capture,
  indexed: ReadonlySet<string>,
): Capture {
  return {
    ...capture,
    players: Object.fromEntries(
      Object.entries(capture.players).filter(([id]) => indexed.has(id)),
    ),
  };
}

/** The manifest's text with the season reach after its last member, as the nightly writes it (Lane 205:
 * research/nightly/run.py with_reach), every byte before it the run's own. */
export function withReach(manifest: string, reach: RunReach): string {
  const body = manifest.trimEnd();
  if (!body.endsWith("}"))
    throw new Error("The manifest is not one JSON object.");
  const parsed = JSON.parse(body) as Record<string, unknown>;
  if ("reach" in parsed)
    throw new Error("The manifest already carries a reach.");
  return `${body.slice(0, -1)},"reach":${JSON.stringify(reach)}}${manifest.slice(body.length)}`;
}

/** The run's season reach as the nightly's schema gate counts it: the web's runReach over the run's
 * own pages (the contract run holds none back), its schedule and its formats, each read through the
 * web's schema. */
async function seasonReachOf(
  read: (path: string) => Promise<string>,
  players: readonly string[],
): Promise<RunReach> {
  const parsed = async <T>(
    path: string,
    schema: { parse: (value: unknown) => T },
  ): Promise<T> => schema.parse(JSON.parse(await read(path)));
  const [manifest, schedule, pages] = await Promise.all([
    parsed(RUN_PATHS.manifest, manifestSchema),
    parsed(RUN_PATHS.schedule, scheduleSchema),
    Promise.all(
      players.map((id) => parsed(RUN_PATHS.player(id), playerSchema)),
    ),
  ]);
  return runReach(pages, schedule.slates, manifest.formats);
}

async function contractRunId(): Promise<string> {
  const ids = (await import(join(REPOSITORY, RUN_IDS))) as {
    CONTRACT_RUN_ID?: unknown;
  };
  if (typeof ids.CONTRACT_RUN_ID !== "string") {
    throw new Error(`${RUN_IDS} exports no CONTRACT_RUN_ID.`);
  }
  return ids.CONTRACT_RUN_ID;
}

const text = (path: string): Promise<string> =>
  readFile(join(REPOSITORY, path), "utf8");

function readme(files: readonly RunFile[], runId: string): string {
  const rows = files.map(
    (f) =>
      `| \`${f.path}\` | ${f.route === null ? "none" : `\`${f.route}\``} | ${f.about} |`,
  );
  return `# The fixture run

${generatedBy(SCRIPT, `${CONTRACT_RUNS}/${runId} and ${DESIGNATIONS}`)}

The nightly's contract fixture run \`${runId}\` as the bucket holds it (\`runs/latest.json\` and
\`runs/<runId>/\`), the run the web's shots build from. The API's run routes test reads this folder
as its bucket and holds every answer equal to its file; the apps may read the same files. The
board, the index, the ADP, the pages, the record, the clubs and the schedule are the run's files
byte for byte; the manifest is the run's with the season reach the nightly writes into it (\`reach\`,
counted by the web's own runReach over this run); the designations are the stand-in's capture held
to the players the run indexes. The run held no page, so it carries no \`held.json\`. The run is older than the boards' Gap
and Drop columns and the kickers' and defenses' rows, so its board carries none of them: the API's
examples for the run routes (api/openapi.yaml) carry each, and the web's test parses them.

| File | Route | What it holds |
| --- | --- | --- |
${rows.join("\n")}
`;
}

/** The build run's files under its root: the pointer, the manifest, every other read the build makes
 * of the run and the designations. */
export function buildRunPaths(
  runId: string,
  copied: readonly string[],
): string[] {
  return [
    "runs/latest.json",
    ...[RUN_PATHS.manifest, ...copied, RUN_PATHS.designations].map(
      (path) => `runs/${runId}/${path}`,
    ),
  ];
}

/** The build run's README: what it is and why it is apart from the apps' fixture run. */
function buildReadme(paths: readonly string[], runId: string): string {
  return `# The build run

${generatedBy(SCRIPT, `${CONTRACT_RUNS}/${runId} and ${DESIGNATIONS}`)}

The nightly's contract fixture run \`${runId}\` as the bucket holds it, with every file a build of the
site reads (web/src/lib/run/reads.ts): every format's board, the index, every player's page, the ADP,
the record, the clubs and the schedule byte for byte, the manifest with its season reach and the
designations as \`shared/fixtures/run\` carries them. A branch's web checks build the site from it and
measure its script bytes with no secret (\`.github/workflows/web.yml\`, Lane 252). It is test data, never
served. \`shared/fixtures/run\` stays the apps' run with the PPR board alone.

${paths.map((path) => `- \`${path}\``).join("\n")}
`;
}

export async function generate(): Promise<Outputs> {
  const runId = await contractRunId();
  const source = (path: string): string => `${CONTRACT_RUNS}/${runId}/${path}`;
  const index = JSON.parse(await text(source("index.json"))) as {
    id: string;
  }[];
  const players = pageIds(index);
  const capture = JSON.parse(await text(DESIGNATIONS)) as Capture;
  const designations = `${JSON.stringify(
    heldToIndex(capture, new Set(index.map((entry) => entry.id))),
  )}\n`;
  const copy = (root: string, paths: readonly string[]) =>
    Promise.all(
      paths.map(async (path): Promise<[string, string]> => [
        `${root}/runs/${runId}/${path}`,
        await text(source(path)),
      ]),
    );
  const fromRun = (path: string): Promise<string> => text(source(path));
  const runManifest = await fromRun(RUN_PATHS.manifest);
  const manifest = withReach(
    runManifest,
    await seasonReachOf(fromRun, players),
  );
  const { formats } = manifestSchema.parse(JSON.parse(runManifest));
  const builtFrom = buildReads(formats, players).filter(
    (path) => path !== RUN_PATHS.manifest,
  );
  const tree = async (
    root: string,
    copied: readonly string[],
    readmeText: string,
  ): Promise<[string, string][]> => [
    [`${root}/runs/latest.json`, `${JSON.stringify({ runId })}\n`],
    [`${root}/runs/${runId}/${RUN_PATHS.manifest}`, manifest],
    ...(await copy(root, copied)),
    [`${root}/runs/${runId}/${RUN_PATHS.designations}`, designations],
    [`${root}/README.md`, readmeText],
  ];
  return new Map([
    ...(await tree(
      RUN_FIXTURE,
      copiedFiles(players),
      readme(runFiles(runId, players), runId),
    )),
    ...(await tree(
      BUILD_RUN_FIXTURE,
      builtFrom,
      buildReadme(buildRunPaths(runId, builtFrom), runId),
    )),
  ]);
}

if (import.meta.main) await writeOutputs(await generate());

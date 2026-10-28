/** The Board's parity over the run (Lane 190): what the web's board page (server/pages/board.ts and
 * BoardView.svelte at 390) builds from a run's files, for the two fixture runs the apps read, as JSON
 * their ports are held to. Each run's stamp and offline lead, its rest-of-season caption and heading,
 * and for every view (All, each ranked position, each kicker's or defense's list) its rows in order
 * with their statuses placed (run/board-status.ts withStatuses), each row's round tint
 * (ui/heat.ts heatFor), its status words (run/status-view.ts), the position's tiers with their bands'
 * words and cliffs (run/tiers.ts tierGroups, TierStrip.svelte), and the basis a phone prints
 * (run/board-basis.ts boardBasis, site/market.ts marketBasis, the capture's few words). Written by
 * export-parity.ts beside the other screens' parity. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  captureShort,
  newerCapture,
  type CaptureStamp,
} from "../../web/src/lib/format/designation.ts";
import { byeLine } from "../../web/src/lib/format/bye.ts";
import { carriesGap } from "../../web/src/lib/format/gap.ts";
import { fixed, plural } from "../../web/src/lib/format/number.ts";
import { adpDrafts } from "../../web/src/lib/run/adp-drafts.ts";
import { boardBasis } from "../../web/src/lib/run/board-basis.ts";
import { heldOut, withStatuses } from "../../web/src/lib/run/board-status.ts";
import {
  LIVE_ORDER_WORDS,
  omittedFromRun,
} from "../../web/src/lib/run/live-order.ts";
import {
  POSITION_NAMES,
  positionsIn,
  rowsAt,
} from "../../web/src/lib/run/derive.ts";
import {
  isMarketPosition,
  marketAt,
  splitBoard,
} from "../../web/src/lib/run/market.ts";
import { restCaption } from "../../web/src/lib/run/rest-words.ts";
import { rowFraming } from "../../web/src/lib/run/row-framing.ts";
import {
  adpSchema,
  boardSchema,
  clubsSchema,
  designationsSchema,
  latestPointerSchema,
  manifestSchema,
  type Designations,
  type Format,
  type Manifest,
} from "../../web/src/lib/run/schema.ts";
import { runStampText } from "../../web/src/lib/run/stamp.ts";
import { boardStatusWords } from "../../web/src/lib/run/status-view.ts";
import { tierGroups } from "../../web/src/lib/run/tiers.ts";
import { marketBasis } from "../../web/src/lib/site/market.ts";
import { offlineLead } from "../../web/src/lib/site/offline-words.ts";
import { boardWords } from "../../web/src/lib/site/season-words.ts";
import { heatFor } from "../../web/src/lib/ui/heat.ts";
import { TIER_WORDS } from "../../web/src/lib/ui/tier.ts";
import type {
  MarketPosition,
  Position,
} from "../../web/src/lib/types/player.ts";
import { REPOSITORY } from "./generated.ts";

export const BOARD_RUN_OUTPUT = "shared/fixtures/parity/board-run.json";

/** The zone the statuses and the capture are said in, the fixtures' own. */
const ZONE = "America/Chicago";

/** Each fixture run the apps read, the clock its board is shown at, and the rail at that clock. */
export const BOARD_RUNS = [
  {
    fixture: "shared/fixtures/standin-run",
    now: "2026-09-01T17:00:00.000Z",
    rail: "pre_draft",
  },
  {
    fixture: "shared/fixtures/run",
    now: "2026-10-22T17:00:00.000Z",
    rail: "in_season",
  },
] as const;

type BoardRun = (typeof BOARD_RUNS)[number];

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(REPOSITORY, path), "utf8"));
}

/** A tier band as the phone draws it: its number, its count and its drop. */
interface TierCase {
  tier: number;
  ids: string[];
  name: string;
  count: string;
  cliff: string;
}

interface ViewCase {
  position: Position | null;
  ids: string[];
  tiers: TierCase[];
  basis: string[];
  /** The capture's sentence follows the basis (BoardView.svelte): always on a ranked view, on a
   * kicker's or a defense's only when one of its rows is listed. */
  capture: boolean;
}

function tiersOf(
  rows: Parameters<typeof tierGroups>[0],
  position: Position,
  unit: string,
): TierCase[] {
  const group = POSITION_NAMES[position];
  return tierGroups(rows, position, heldOut).map((tier) => ({
    tier: tier.tier,
    ids: tier.rows.map((row) => row.id),
    name: `${TIER_WORDS.tier} ${String(tier.tier)}`,
    count: plural(tier.rows.length, group.one, group.many),
    cliff:
      tier.cliff === null
        ? TIER_WORDS.lastTier
        : `${fixed(tier.cliff.drop)} ${unit} ${TIER_WORDS.toTier} ${String(tier.cliff.nextTier)}`,
  }));
}

async function viewsOf(
  run: BoardRun,
  manifest: Manifest,
  format: Format,
): Promise<ViewCase[]> {
  const board = splitBoard(
    boardSchema.parse(
      await json(
        `${run.fixture}/runs/${manifest.runId}/boards/${format.id}.json`,
      ),
    ),
  );
  const { sources } = adpSchema.parse(
    await json(`${run.fixture}/runs/${manifest.runId}/adp.json`),
  );
  const capture = await designationsOf(run, manifest);
  const ranked = (position: Position | null): ViewCase => {
    const rows = withStatuses(
      position === null ? board.rows : rowsAt(board.rows, position),
      capture,
    );
    return {
      position,
      ids: rows.map((row) => row.id),
      tiers: position === null ? [] : tiersOf(rows, position, format.unit),
      basis: boardBasis({
        format,
        season: manifest.season,
        order: "board",
        position,
        adpBasis: adpDrafts(sources, format.id),
        gap: rowFraming(format).compare && carriesGap(rows),
        reach: null,
      })
        .filter((part) => part.phone)
        .map((part) => part.text),
      capture: capture !== null,
    };
  };
  const marketView = (position: MarketPosition): ViewCase => {
    const rows = withStatuses(marketAt(board.market, position), capture);
    return {
      position,
      ids: rows.map((row) => row.id),
      tiers: [],
      basis: [marketBasis(format, sources)],
      capture: rows.some((row) => row.status !== undefined),
    };
  };
  return [null, ...positionsIn([...board.rows, ...board.market])].map(
    (position) =>
      position !== null && isMarketPosition(position)
        ? marketView(position)
        : ranked(position),
  );
}

async function designationsOf(
  run: BoardRun,
  manifest: Manifest,
): Promise<Designations | null> {
  const read = await json(
    `${run.fixture}/runs/${manifest.runId}/designations.json`,
  );
  // The fixtures carry no source (the API drops it): the schema's provenance is put back to parse.
  return read === null
    ? null
    : designationsSchema.parse({ source: "fixture", ...(read as object) });
}

async function runCase(run: BoardRun): Promise<unknown> {
  const { runId } = latestPointerSchema.parse(
    await json(`${run.fixture}/runs/latest.json`),
  );
  const manifest = manifestSchema.parse({
    sources: [
      {
        artifact: "boards",
        vendor: "fixture",
        feed: "fixture",
        window: { from: run.now, to: run.now },
      },
    ],
    ...((await json(`${run.fixture}/runs/${runId}/manifest.json`)) as object),
  });
  const format = manifest.formats[0];
  if (format === undefined)
    throw new Error(`${run.fixture} carries no format.`);
  const board = splitBoard(
    boardSchema.parse(
      await json(`${run.fixture}/runs/${runId}/boards/${format.id}.json`),
    ),
  );
  const capture = await designationsOf(run, manifest);
  const now = Date.parse(run.now);
  const listed = withStatuses([...board.rows, ...board.market], capture);
  // The board's Bye cells, from the run's clubs (server/run.ts clubByes).
  const clubs = clubsSchema.parse(
    await json(`${run.fixture}/runs/${runId}/clubs.json`),
  );
  const byes = new Map(clubs.map((club) => [club.abbr, club.bye]));
  const statuses =
    capture === null
      ? null
      : boardStatusWords(listed, {
          capture,
          restOfSeason: format.rosFromWeek !== undefined,
          zone: ZONE,
          now,
        });
  return {
    fixture: run.fixture,
    runId,
    now: run.now,
    format: format.id,
    stamp: runStampText({ ...manifest, search: "", formats: [] }),
    offline: offlineLead(manifest.runAt),
    restCaption: restCaption(format, manifest.season),
    words: boardWords(
      run.rail,
      {
        season: manifest.season,
        label: format.label,
        position: null,
        ...(format.rosFromWeek === undefined
          ? {}
          : { rosFromWeek: format.rosFromWeek }),
      },
      false,
    ),
    capture: statuses?.capture ?? null,
    statuses: statuses === null ? {} : statuses.rows,
    // The phone's bye beside the club (Row.svelte byeLine): "Bye week 11", nothing once played.
    byes: Object.fromEntries(
      listed.map((row) => [
        row.id,
        byeLine(byes.get(row.team) ?? null, format.rosFromWeek ?? null),
      ]),
    ),
    heats: Object.fromEntries(
      board.rows.map((row) => [row.id, heatFor(row.vor, row.vorRound)]),
    ),
    views: await viewsOf(run, manifest, format),
  };
}

const HOUR_MS = 60 * 60 * 1000;

function shifted(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString();
}

/** The in-season run's manifest, its first format's board and its capture. */
async function inSeasonRun(): Promise<{
  board: ReturnType<typeof splitBoard>;
  capture: Designations | null;
}> {
  const run = BOARD_RUNS[1];
  const { runId } = latestPointerSchema.parse(
    await json(`${run.fixture}/runs/latest.json`),
  );
  const manifest = manifestSchema.parse({
    sources: [],
    ...((await json(`${run.fixture}/runs/${runId}/manifest.json`)) as object),
  });
  const format = manifest.formats[0];
  if (format === undefined)
    throw new Error(`${run.fixture} carries no format.`);
  const board = splitBoard(
    boardSchema.parse(
      await json(`${run.fixture}/runs/${runId}/boards/${format.id}.json`),
    ),
  );
  return { board, capture: await designationsOf(run, manifest) };
}

/** The Board's status stamp at the order's clock (Lane 280, B257, designation.ts newerCapture), over
 * the in-season run's capture: the run's alone, a live order whose capture was read after it, within
 * hours of the clock (checked, and unchecked), and one read before it. Each says the chosen capture in captureShort's words. */
function liveStamps(designations: Designations): unknown[] {
  const run = BOARD_RUNS[1];
  const capture: CaptureStamp = {
    readAt: designations.readAt,
    checkedAt: designations.checkedAt,
  };
  const last = capture.checkedAt ?? capture.readAt;
  const cases: { name: string; live: CaptureStamp | null }[] = [
    { name: "run-only", live: null },
    {
      name: "live-newer",
      live: { readAt: shifted(run.now, -5), checkedAt: shifted(run.now, -1) },
    },
    {
      name: "live-newer-unchecked",
      live: { readAt: shifted(run.now, -3), checkedAt: null },
    },
    {
      name: "live-older",
      live: { readAt: shifted(last, -30), checkedAt: shifted(last, -6) },
    },
  ];
  return cases.map(({ name, live }) => {
    const chosen = newerCapture(capture, live) ?? capture;
    return {
      name,
      now: run.now,
      run: capture,
      live,
      chosen: chosen === live ? "live" : "run",
      text: captureShort(chosen, Date.parse(run.now), ZONE),
    };
  });
}

/** The run's players an answer omits (Lane 280, B257, live-order.ts omittedFromRun and
 * LIVE_ORDER_WORDS.fromRunLine), over the in-season run's rows: an uncut answer that returns them
 * all, one that leaves two out (drawn from the run, counted once), and a cut one (its limit's, none
 * counted). */
function fromRunCases(board: ReturnType<typeof splitBoard>): unknown[] {
  const runIds = board.rows.map((row) => row.id);
  type Answer = Parameters<typeof omittedFromRun>[1];
  const answer = (ids: string[], total: number): Answer =>
    ({
      rows: ids.map((id) => ({ line: { player: { board_id: id } } })),
      total,
    }) as unknown as Answer;
  const cases = [
    { name: "uncut-whole", answerIds: runIds, cut: false },
    {
      name: "uncut-omits",
      answerIds: runIds.filter((_, i) => i !== 1 && i !== 3),
      cut: false,
    },
    { name: "cut", answerIds: runIds.slice(0, 2), cut: true },
  ];
  return cases.map(({ name, answerIds, cut }) => {
    const total = cut ? 40 : answerIds.length;
    const omitted = omittedFromRun(runIds, answer(answerIds, total));
    return {
      name,
      runIds,
      answerIds,
      total,
      omitted,
      line: LIVE_ORDER_WORDS.fromRunLine(omitted.length),
    };
  });
}

export async function renderBoardRun(about: string): Promise<string> {
  const runs = [];
  for (const run of BOARD_RUNS) runs.push(await runCase(run));
  const inSeason = await inSeasonRun();
  if (inSeason.capture === null)
    throw new Error(`${BOARD_RUNS[1].fixture} carries no capture.`);
  const body = {
    about,
    zone: ZONE,
    runs,
    liveStamps: liveStamps(inSeason.capture),
    fromRun: fromRunCases(inSeason.board),
  };
  return `${JSON.stringify(body, null, "\t")}\n`;
}

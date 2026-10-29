/** What the web's own readers draw from the shared fixtures, as JSON the apps' tests hold their ports
 * to: the League home's score bugs, standings, moves feed and bases (web/src/lib/league/home/home.ts)
 * at each fixture clock, in the fixture's zone, and every lineup line's and scoreboard game's state
 * (game-state-parity.ts), which the API's own test holds its wire field to. An app that ports a reader (plan 2026-10-24 Global
 * Constraints: no screen computes game state once the API serves it, until then it ports the web's
 * reader) asserts its output equals this file, so a change to the web's words or rules fails the
 * app's test until the port follows.
 *
 *   node shared/scripts/export-parity.ts
 *
 * It reads the committed fixtures (export-fixtures.ts writes them; check-gen holds both). */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  REPOSITORY,
  generatedBy,
  writeOutputs,
  type Outputs,
} from "./generated.ts";
import { BOX } from "../../web/src/lib/league/box/box.ts";
import { fixed } from "../../web/src/lib/format/number.ts";
import {
  bugsFinalNone,
  bugsMissListedFinal,
  bugsOf,
  bugsPlayingListed,
  feedRows,
  playoffRule,
  projections,
  recordCell,
  seedingWords,
  standingsBasis,
  standingsRows,
  teamBasis,
  unlistedDrawn,
  waiverCell,
} from "../../web/src/lib/league/home/home.ts";
import {
  leagueWeekParts,
  weekBasisText,
} from "../../web/src/lib/league/home/week-basis.ts";
import type { LeagueSync } from "../../web/src/lib/league/api.ts";
import {
  LEAGUE_PHASES,
  PHONE_RAIL_ITEMS,
  RAIL_FOOT,
  railKey,
  railPhase,
  type SitePhase,
} from "../../web/src/lib/ui/nav.ts";
import {
  RAIL_WITHOUT_LEAGUE,
  railFor,
  railShown,
} from "../../web/src/lib/ui/rail-order.ts";
import {
  leagueLine,
  phaseWords,
} from "../../web/src/lib/context/menu-words.ts";
import type { ContextLeague } from "../../web/src/lib/context/words.ts";
import { followedName } from "../../web/src/lib/league/names.ts";
import { CARD, unreadBasis } from "../../web/src/lib/player/card.ts";
import { railItemLabel } from "../../web/src/lib/run/week-names.ts";
import type { Scoreboard } from "../../web/src/lib/league/inseason/api.ts";
import {
  LINEUP_OUTPUT,
  lineupAt,
  moveWords,
  withWrites,
} from "./lineup-parity.ts";
import type {
  LineupAdvice,
  MatchupBox,
} from "../../web/src/lib/league/inseason/api.ts";
import { gapsOf, MATCHUP_OUTPUT, matchupAt } from "./matchup-parity.ts";
import {
  claimWords,
  sortSteps,
  stashCases,
  WAIVERS_OUTPUT,
  waiversAt,
} from "./waivers-parity.ts";
import { inTenths } from "../../web/scripts/inseason-fixture/tenths.ts";
import {
  irDropWaivers,
  listedOnly,
} from "../../web/scripts/inseason-fixture/waiver-beats.ts";
import { stamped } from "../../web/scripts/inseason-fixture/game-state.ts";
import { withRuleList } from "../../web/scripts/inseason-fixture/week.ts";
import type {
  HostMoveResult,
  WaiverAdvice,
} from "../../web/src/lib/league/inseason/api.ts";
import { BOARD_OUTPUT, renderBoard } from "./board-parity.ts";
import { BOARD_RUN_OUTPUT, renderBoardRun } from "./board-run-parity.ts";
import {
  PLAYER_SHEET_OUTPUT,
  renderPlayerSheet,
} from "./player-sheet-parity.ts";
import { RANKINGS_OUTPUT, renderRankings } from "./rankings-parity.ts";
import { RECORD_OUTPUT, renderRecord } from "./record-parity.ts";
import { REFERENCE_OUTPUT, renderReference } from "./reference-parity.ts";
import {
  builderAt,
  checkAt,
  copiedWords,
  holdingAt,
  TRADES_OUTPUT,
  tradesAt,
  wordCases,
} from "./trades-parity.ts";
import { HOLDING_PLAYER, OTHER_GAME_ROSTER } from "./export-fixtures.ts";
import { ACCOUNT_OUTPUT, renderAccount } from "./account-parity.ts";
import {
  ACCOUNT_DELETE_OUTPUT,
  renderAccountDelete,
} from "./account-delete-parity.ts";
import { COMPANION_OUTPUT, renderCompanion } from "./companion-parity.ts";
import { MOCK_OUTPUT, renderMock } from "./mock-parity.ts";
import { renderOneValue } from "./one-value-parity.ts";
import { LOBBY_OUTPUT, renderLobby } from "./lobby-parity.ts";
import { SHEET_OUTPUT, renderSheet } from "./sheet-parity.ts";
import { FIGURES_OUTPUT, renderFigures } from "./figures-parity.ts";
import type { Account } from "../../web/src/lib/account/account-api.ts";
import type { AttachedLeague } from "../../web/src/lib/league/api.ts";
import type { Device } from "../../web/src/lib/hosts/api.ts";
import { worthProposing } from "../../web/src/lib/league/box/trades.ts";
import type {
  TradeAdvice,
  TradeCheck,
} from "../../web/src/lib/league/inseason/api.ts";
import {
  GAME_STATE_OUTPUT,
  lineRows,
  renderGameState,
  scoreboardRows,
  type GameStateRow,
} from "./game-state-parity.ts";

const SCRIPT = "shared/scripts/export-parity.ts";
export const OUTPUT = "shared/fixtures/parity/league-home.json";
export const RAIL_OUTPUT = "shared/fixtures/parity/phone-rail.json";
export const SHELL_OUTPUT = "shared/fixtures/parity/shell.json";
/** The site's own seasons (GET /season's phase), each read with no league followed. */
export const SITE_PHASES: readonly SitePhase[] = [
  "preseason",
  "in_season",
  "playoffs",
  "offseason",
];
/** A week the season has named: the in-season rails' week item says Rankings then. */
const NAMED_WEEK = 7;
const INSEASON = "shared/fixtures/inseason";
const LEAGUE = "6f1d1c52-2626-4a26-9a26-000000000026";
/** The fixture's zone: its clocks are named on Central time (shared/fixtures/README.md). */
export const ZONE = "America/Chicago";
/** Every scoreboard clock the fixtures carry, as its file names it. */
export const CLOCKS = [
  "2026-10-16T02-00-00Z",
  "2026-10-17T17-00-00Z",
  "2026-10-18T18-56-00Z",
  "2026-10-19T16-00-00Z",
  "2026-10-20T00-40-00Z",
  "2026-10-20T17-00-00Z",
] as const;

/** A file name's clock as an instant: `2026-10-17T17-00-00Z` as `2026-10-17T17:00:00.000Z`. */
export function instantOf(clock: string): string {
  return clock.replace(/T(\d\d)-(\d\d)-(\d\d)Z$/, "T$1:$2:$3.000Z");
}

const figure = (value: number | null): string =>
  value === null ? BOX.none : fixed(value, 1);

/** The League home at one clock: the score bugs, the standings rows as a phone draws them, the team
 * basis whole and the page's basis paragraph as a phone says it (with no Lineup read, so no Game
 * sentence), each exactly as the web's readers give them. */
export function homeAt(
  sync: LeagueSync,
  board: Scoreboard,
  now: string,
): unknown {
  const at = Date.parse(now);
  const bugs = bugsOf(board, sync, at, ZONE, {
    host: sync.host,
    readAt: board.read_at,
  });
  const started = bugs.some((b) => b.state !== "upcoming");
  return {
    now,
    bugs: bugs.map((b) => ({
      mine: b.mine,
      state: b.state,
      head: b.head,
      words: b.words,
      small: b.columns.small,
      big: b.columns.big,
      sides: b.sides.map((s) => ({
        name: s.name,
        record: s.record,
        me: s.me,
        small: s.small,
        big: s.big,
        toPlay: s.toPlay,
        stands: s.stands,
      })),
    })),
    standings: standingsRows(sync, projections(board, at)).map((r) => ({
      rank: r.rank,
      team: r.team.name,
      record: recordCell(r.team),
      pointsFor: fixed(r.team.points_for, 1),
      pointsAgainst: figure(r.team.points_against),
      streak: r.team.streak ?? "",
      waiver: waiverCell(r.team, sync.terms),
      proj: figure(r.proj),
      me: r.me,
    })),
    teamBasis: teamBasis(
      sync.host,
      board.projection_read_at,
      board.projection_scoring,
      false,
      ZONE,
      started,
      bugsMissListedFinal(bugs),
      bugsPlayingListed(bugs),
      bugsFinalNone(bugs),
      unlistedDrawn(bugs),
    ),
    phoneBasis: weekBasisText(
      leagueWeekParts({
        sync,
        scoreboard: board,
        playerPoints: false,
        gameLines: null,
        bugs,
        now: at,
        zone: ZONE,
      }),
      "phone",
    ),
  };
}

/** The parity file from the league's sync answer and its scoreboard answers by clock. */
export function renderParity(
  sync: LeagueSync,
  boards: ReadonlyMap<string, Scoreboard>,
): string {
  const clocks = Object.fromEntries(
    [...boards].map(([clock, board]) => [
      clock,
      homeAt(sync, board, instantOf(clock)),
    ]),
  );
  const parity = {
    about: generatedBy(
      SCRIPT,
      "web/src/lib/league/home/home.ts over shared/fixtures/inseason",
    ),
    zone: ZONE,
    league: sync.id,
    clocks,
    moves: feedRows(sync, ZONE).map((r) => ({
      when: r.when,
      kind: r.kind,
      teams: r.teams.map((t) => t.name),
      adds: r.adds.map((p) => ({
        name: p.name,
        position: p.position,
        club: p.club,
        to: p.to,
      })),
      drops: r.drops.map((p) => ({
        name: p.name,
        position: p.position,
        club: p.club,
      })),
      detail: r.detail,
      mine: r.mine,
    })),
    playoffRule: playoffRule(sync.terms, sync.teams.length),
    seeding: seedingWords(sync.terms, sync.host),
    standingsBasis: standingsBasis(sync.host, sync.terms),
  };
  return `${JSON.stringify(parity, null, "\t")}\n`;
}

interface PhoneItem {
  key: string;
  label: string;
}

const phoneFive = (
  items: readonly { key: string; label: string; wideOnly: boolean }[],
): PhoneItem[] =>
  items
    .filter((item) => !item.wideOnly)
    .slice(0, PHONE_RAIL_ITEMS)
    .map((item) => ({ key: item.key, label: railItemLabel(item, NAMED_WEEK) }));

/** The phone's bottom bar for each phase of a followed league (web/src/lib/ui/rail-order.ts railFor),
 * the playoffs with waivers open and closed, the bar with no league followed, and that bar by the
 * site's own season (GET /season: the draft's bar before the season and after it, the season's bar
 * without a league in it, railShown), as the web draws them with the season's week named, and the
 * account's way in by its label. The apps' bars are held to it. */
export function renderRail(): string {
  const phases = Object.fromEntries(
    LEAGUE_PHASES.flatMap((phase) =>
      phase === "playoffs"
        ? [
            ["playoffs", phoneFive(railFor(phase, false))],
            ["playoffs_waivers", phoneFive(railFor(phase, true))],
          ]
        : [[phase, phoneFive(railFor(phase, true))]],
    ),
  );
  const rail = {
    about: generatedBy(SCRIPT, "web/src/lib/ui/rail-order.ts"),
    phases,
    withoutLeague: phoneFive(RAIL_WITHOUT_LEAGUE),
    withoutLeagueBySeason: Object.fromEntries(
      SITE_PHASES.map((season) => [
        season,
        phoneFive(railShown(railKey(railPhase(null, season)), false)),
      ]),
    ),
    account: { key: RAIL_FOOT.key, label: RAIL_FOOT.label },
  };
  return `${JSON.stringify(rail, null, "\t")}\n`;
}

/** A followed league as the switch reads it: the attached league's id, name, platform, phase and
 * draft time. */
type SwitchLeague = Pick<
  ContextLeague,
  "id" | "name" | "host" | "phase" | "draft_at"
>;

/** The switch's clocks: the fixture's week (a draft today, one in four days), its Thursday night (a
 * draft in two days), its Tuesday (a draft tomorrow, one under way), and nine days before a draft
 * (named by its date). */
const SWITCH_NOWS = [
  "2026-10-17T17:00:00.000Z",
  "2026-10-16T02:00:00.000Z",
  "2026-10-20T17:00:00.000Z",
  "2026-10-12T17:00:00.000Z",
] as const;

/** The leagues the switch is held on: the fixture account's twelve, one more before a draft with no
 * time and no name read yet (its platform names it), and the season's seven alone (one phase, so no
 * phase words). */
function switchSets(
  attached: readonly SwitchLeague[],
): Record<string, readonly SwitchLeague[]> {
  const unnamed: SwitchLeague = {
    id: "6f1d1c52-2626-4a26-9a26-000000000099",
    name: "",
    host: "yahoo",
    phase: "pre_draft",
    draft_at: null,
  };
  return {
    account: attached,
    withUnnamed: [...attached, unnamed],
    oneSeason: attached.filter((league) => league.phase === "in_season"),
  };
}

/** The line under a league in the switch (context/menu-words.ts leagueLine) for every platform, every
 * scoring preset and both the boards a league can read on that change it (PPR, superflex). */
function switchLines(): {
  host: string;
  scoring: string;
  format: string;
  line: string;
}[] {
  const hosts = ["sleeper", "mfl", "ffpc", "yahoo", "espn"] as const;
  const scorings = ["ppr", "half_ppr", "standard", "te_premium"] as const;
  const formats = ["ppr", "superflex"] as const;
  return hosts.flatMap((host) =>
    scorings.flatMap((scoring) =>
      formats.map((format) => ({
        host,
        scoring,
        format,
        line: leagueLine({ host, scoring, format } as ContextLeague),
      })),
    ),
  );
}

/** The league switch as the web's menu words it (context/menu-words.ts phaseWords, league/names.ts
 * followedName) for each set of leagues at each clock in the fixture's zone, and the player shelf's
 * basis line while his week is read (player/card.ts unreadBasis, the shelf's words as it opens). */
export function renderShell(attached: readonly SwitchLeague[]): string {
  const sets = switchSets(attached);
  const cases = Object.entries(sets).flatMap(([set, leagues]) =>
    SWITCH_NOWS.map((now) => ({
      set,
      now,
      leagues: leagues.map((league) => ({
        id: league.id,
        name: league.name,
        host: league.host,
        phase: league.phase,
        draft_at: league.draft_at,
      })),
      names: Object.fromEntries(
        leagues.map((league) => [league.id, followedName(league)]),
      ),
      phases: Object.fromEntries(
        phaseWords(leagues as readonly ContextLeague[], new Date(now), ZONE),
      ),
    })),
  );
  const shell = {
    about: generatedBy(
      SCRIPT,
      "web/src/lib/context/menu-words.ts and web/src/lib/player/card.ts over shared/fixtures/inseason",
    ),
    zone: ZONE,
    cases,
    lines: switchLines(),
    sheetLoading: unreadBasis(false, CARD.proj),
  };
  return `${JSON.stringify(shell, null, "\t")}\n`;
}

async function answer<T>(file: string): Promise<T> {
  const text = await readFile(join(REPOSITORY, INSEASON, file), "utf8");
  return (JSON.parse(text) as { data: T }).data;
}

/** The fixture answer a route names at a clock, as the game-state rows cite it. */
const sourceOf = (route: "lineup" | "scoreboard", clock: string) => ({
  route: `GET /leagues/attached/${LEAGUE}/${route}`,
  clock: instantOf(clock),
  fixture: `${INSEASON}/${route}-${LEAGUE}-${clock}.json`,
});

/** Every lineup line and scoreboard game at every clock, by the web's game-state readers. */
async function gameStateRows(
  boards: ReadonlyMap<string, Scoreboard>,
): Promise<GameStateRow[]> {
  const rows: GameStateRow[] = [];
  for (const clock of CLOCKS) {
    const lineup = sourceOf("lineup", clock);
    rows.push(
      ...lineRows(
        lineup,
        await answer<unknown>(`lineup-${LEAGUE}-${clock}.json`),
      ),
    );
    const board = boards.get(clock);
    if (board !== undefined)
      rows.push(...scoreboardRows(sourceOf("scoreboard", clock), board));
  }
  return rows;
}

/** The platform that takes lineups from here, for the parity's second set (lineup-parity.ts). */
const WRITES_HOST = "espn";

/** The Start screen at every clock as the fixture's league reads it, the same answers with the
 * platform's writes open, and the move's words (lineup-parity.ts). */
export async function renderLineup(host: LeagueSync["host"]): Promise<string> {
  const answers = new Map<string, LineupAdvice>();
  for (const clock of CLOCKS)
    answers.set(
      clock,
      await answer<LineupAdvice>(`lineup-${LEAGUE}-${clock}.json`),
    );
  const at = (writes: boolean, platform: LeagueSync["host"]) =>
    Object.fromEntries(
      [...answers].map(([clock, advice]) => [
        clock,
        lineupAt(
          writes ? withWrites(advice) : advice,
          platform,
          instantOf(clock),
          ZONE,
        ),
      ]),
    );
  const lineup = {
    about: generatedBy(
      SCRIPT,
      "web/src/lib/league/box/lineup.ts, basis.ts and inseason/move.ts over shared/fixtures/inseason",
    ),
    zone: ZONE,
    host,
    writesHost: WRITES_HOST,
    clocks: at(false, host),
    writes: at(true, WRITES_HOST),
    moves: moveWords(),
  };
  return `${JSON.stringify(lineup, null, "\t")}\n`;
}

/** Another team's game at every clock (Lane 206): its box asked by roster with the league read and the
 * scoreboard it is drawn with, all three as the Sleeper league reads them. */
async function otherGameAt(): Promise<Record<string, unknown>> {
  const games: Record<string, unknown> = {};
  for (const clock of CLOCKS)
    games[clock] = matchupAt(
      await answer<LeagueSync>(`sync-${LEAGUE}-sleeper-${clock}.json`),
      await answer<MatchupBox>(
        `matchup-${LEAGUE}-roster-${String(OTHER_GAME_ROSTER)}-${clock}.json`,
      ),
      instantOf(clock),
      ZONE,
      await answer<Scoreboard>(`scoreboard-${LEAGUE}-sleeper-${clock}.json`),
    );
  return games;
}

/** The Matchup at every clock as the fixture's league reads it, the same reads without the box
 * answer, the gap sentences with no matchup, and another team's game (matchup-parity.ts). */
export async function renderMatchup(): Promise<string> {
  const reads: [string, LeagueSync, MatchupBox][] = [];
  for (const clock of CLOCKS)
    reads.push([
      clock,
      await answer<LeagueSync>(`sync-${LEAGUE}-${clock}.json`),
      await answer<MatchupBox>(`matchup-${LEAGUE}-${clock}.json`),
    ]);
  const at = (withBox: boolean) =>
    Object.fromEntries(
      reads.map(([clock, sync, box]) => [
        clock,
        matchupAt(sync, withBox ? box : null, instantOf(clock), ZONE),
      ]),
    );
  const [first] = reads;
  if (first === undefined)
    throw new Error("No fixture clock to read the Matchup at.");
  const matchup = {
    about: generatedBy(
      SCRIPT,
      "web/src/lib/league/box/matchup.ts, basis.ts and MatchupPanel.svelte over shared/fixtures/inseason",
    ),
    zone: ZONE,
    clocks: at(true),
    withoutBox: at(false),
    gaps: gapsOf(first[1], instantOf(first[0])),
    otherGame: await otherGameAt(),
  };
  return `${JSON.stringify(matchup, null, "\t")}\n`;
}

/** The ESPN stand-ins whose claim is made from here, by what it comes to (shared/fixtures README). */
export const ESPN_LEAGUES = {
  done: "6f1d1c52-2626-4a26-9a26-000000000035",
  refused: "6f1d1c52-2626-4a26-9a26-000000000036",
  pending: "6f1d1c52-2626-4a26-9a26-000000000037",
} as const;
/** The clock the ESPN stand-ins' Waivers and claims are read at: the fixture's week. */
const WEEK_CLOCK = "2026-10-17T17-00-00Z";

/** The Waivers at every clock as the fixture's league reads it, each ESPN stand-in's at the week's
 * clock (the claim made from here), and the claim's words (waivers-parity.ts). */
export async function renderWaivers(host: LeagueSync["host"]): Promise<string> {
  const clocks: Record<string, unknown> = {};
  for (const clock of CLOCKS)
    clocks[clock] = waiversAt(
      await answer<WaiverAdvice>(`waivers-${LEAGUE}-${clock}.json`),
      host,
      instantOf(clock),
      ZONE,
    );
  const espn: Record<string, unknown> = {};
  const claims: HostMoveResult[] = [];
  for (const [outcome, id] of Object.entries(ESPN_LEAGUES)) {
    espn[outcome] = {
      id,
      screen: waiversAt(
        await answer<WaiverAdvice>(`waivers-${id}-${WEEK_CLOCK}.json`),
        "espn",
        instantOf(WEEK_CLOCK),
        ZONE,
      ),
    };
    claims.push(await answer<HostMoveResult>(`claim-move-${id}.json`));
  }
  // The D/ST chip's read at the week's clock: the page's answer with the narrowed one shown.
  const page = await answer<WaiverAdvice>(
    `waivers-${LEAGUE}-${WEEK_CLOCK}.json`,
  );
  const narrowed = {
    DEF: waiversAt(
      page,
      host,
      instantOf(WEEK_CLOCK),
      ZONE,
      await answer<WaiverAdvice>(`waivers-${LEAGUE}-DEF-${WEEK_CLOCK}.json`),
    ),
  };
  // The Stash group and a clearing day (review M1), over stash.test.ts's inputs, each with its answer.
  const stored = inTenths(
    JSON.parse(
      await readFile(
        join(REPOSITORY, "web/scripts/inseason-fixture/data/waivers.json"),
        "utf8",
      ),
    ),
  ) as WaiverAdvice;
  const cases = stashCases(
    listedOnly(irDropWaivers(stored), true),
    listedOnly(irDropWaivers(stored), false),
  );
  // Each as the fixture API sends an answer: the rules our stats lack listed, every line stamped with
  // its game state at the week's clock.
  const served = (advice: WaiverAdvice): WaiverAdvice =>
    stamped(
      withRuleList(advice),
      Date.parse(instantOf(WEEK_CLOCK)),
    ) as WaiverAdvice;
  const stashed = Object.fromEntries(
    Object.entries(cases).map(([name, advice]) => [
      name,
      {
        advice: served(advice),
        screen: waiversAt(served(advice), host, instantOf(WEEK_CLOCK), ZONE),
      },
    ]),
  );
  const waivers = {
    about: generatedBy(
      SCRIPT,
      "web/src/lib/league/box/waivers.ts, basis.ts and inseason/move.ts over shared/fixtures/inseason",
    ),
    zone: ZONE,
    host,
    clocks,
    espnClock: WEEK_CLOCK,
    espn,
    narrowed,
    stashed,
    sortSteps: sortSteps(),
    claim: claimWords(claims, ZONE),
  };
  return `${JSON.stringify(waivers, null, "\t")}\n`;
}

/** The clocks the fixtures post the strip's checks at (export-fixtures.ts), and how many each. */
const CHECK_CLOCKS = ["2026-10-17T17-00-00Z", "2026-10-18T18-56-00Z"] as const;
const CHECKS_AT_A_CLOCK = 2;

/** The Trades at every clock as the fixture's league reads it, every check the fixtures post, and the
 * line under a pressed verb (trades-parity.ts). The member's team is the switch's (leagues-attached),
 * the platform the league read's. */
export async function renderTrades(host: LeagueSync["host"]): Promise<string> {
  const attached = await answer<{ id: string; team_name: string }[]>(
    "leagues-attached.json",
  );
  const me = attached.find((l) => l.id === LEAGUE)?.team_name ?? "";
  const clocks: Record<string, unknown> = {};
  for (const clock of CLOCKS) {
    const advice = await answer<TradeAdvice>(`trades-${LEAGUE}-${clock}.json`);
    clocks[clock] = tradesAt(advice, host, me, instantOf(clock), ZONE);
  }
  const checks: Record<string, unknown[]> = {};
  for (const clock of CHECK_CLOCKS) {
    const advice = await answer<TradeAdvice>(`trades-${LEAGUE}-${clock}.json`);
    const read: unknown[] = [];
    for (let n = 1; n <= CHECKS_AT_A_CLOCK; n += 1) {
      const check = await answer<TradeCheck>(
        `trade-check-${LEAGUE}-${clock}-${String(n)}.json`,
      );
      // The fixtures post the strip's trades in its order (export-fixtures.ts checkBody).
      const team = worthProposing(advice.teams)[n - 1]?.team.name ?? "";
      read.push(checkAt(check, me, team, instantOf(clock)));
    }
    checks[clock] = read;
  }
  const weekAdvice = await answer<TradeAdvice>(
    `trades-${LEAGUE}-${CHECK_CLOCKS[0]}.json`,
  );
  const firstCheck = await answer<TradeCheck>(
    `trade-check-${LEAGUE}-${CHECK_CLOCKS[0]}-1.json`,
  );
  const trades = {
    about: generatedBy(
      SCRIPT,
      "web/src/lib/league/box/trades.ts, basis.ts, inseason/builder.ts and words.ts over shared/fixtures/inseason",
    ),
    zone: ZONE,
    host,
    me,
    clocks,
    checks,
    copied: copiedWords(host),
    words: wordCases(firstCheck),
    holding: holdingAt(
      weekAdvice,
      await answer<TradeAdvice>(
        `trades-${LEAGUE}-player-${HOLDING_PLAYER}-${CHECK_CLOCKS[0]}.json`,
      ),
      HOLDING_PLAYER,
      me,
      instantOf(CHECK_CLOCKS[0]),
      ZONE,
    ),
    builder: builderAt(
      weekAdvice,
      firstCheck,
      me,
      instantOf(CHECK_CLOCKS[0]),
      ZONE,
    ),
  };
  return `${JSON.stringify(trades, null, "\t")}\n`;
}

export async function generate(): Promise<Outputs> {
  const sync = await answer<LeagueSync>(`leagues-attached-${LEAGUE}.json`);
  const boards = new Map<string, Scoreboard>();
  for (const clock of CLOCKS)
    boards.set(
      clock,
      await answer<Scoreboard>(`scoreboard-${LEAGUE}-${clock}.json`),
    );
  const about = generatedBy(
    SCRIPT,
    "web/src/lib/league/box/kickoff.ts (lineState, gameHead) over shared/fixtures/inseason",
  );
  return new Map([
    [OUTPUT, renderParity(sync, boards)],
    [RAIL_OUTPUT, renderRail()],
    [
      SHELL_OUTPUT,
      renderShell(await answer<SwitchLeague[]>("leagues-attached.json")),
    ],
    [GAME_STATE_OUTPUT, renderGameState(about, await gameStateRows(boards))],
    [
      FIGURES_OUTPUT,
      await renderFigures(
        generatedBy(
          SCRIPT,
          "web/src/lib/league/home/figures.ts (gapFigure, powerPanel, startSitRow) over shared/fixtures/inseason with the fixture API's Lane 292 fields (web/scripts/inseason-fixture/figures.ts)",
        ),
        LEAGUE,
        ZONE,
        CLOCKS,
        instantOf,
      ),
    ],
    [LINEUP_OUTPUT, await renderLineup(sync.host)],
    [MATCHUP_OUTPUT, await renderMatchup()],
    [
      BOARD_OUTPUT,
      renderBoard(
        generatedBy(
          SCRIPT,
          "web/src/lib/site/season-words.ts (boardWords), web/src/lib/format/number.ts and gap.ts",
        ),
      ),
    ],
    [
      BOARD_RUN_OUTPUT,
      await renderBoardRun(
        generatedBy(
          SCRIPT,
          "web/src/lib/server/pages/board.ts (its tiers, statuses, tints and basis) over the two fixture runs",
        ),
      ),
    ],
    [WAIVERS_OUTPUT, await renderWaivers(sync.host)],
    [
      PLAYER_SHEET_OUTPUT,
      await renderPlayerSheet(
        generatedBy(
          SCRIPT,
          "web/src/lib/player (the shelf: week-read.ts, status-held.ts, week-words.ts, shelf.ts) and server/pages/player.ts (the page's words) over the fixture runs and shared/fixtures/inseason",
        ),
      ),
    ],
    [TRADES_OUTPUT, await renderTrades(sync.host)],
    [
      RANKINGS_OUTPUT,
      await renderRankings(
        generatedBy(
          SCRIPT,
          "web/src/lib/order (orderView, orderSections, orderBasis, weekView, weekSections, weekBasis) over the order answers in shared/fixtures/inseason",
        ),
      ),
    ],
    [
      RECORD_OUTPUT,
      await renderRecord(
        generatedBy(
          SCRIPT,
          "web/src/lib/run/record.ts and records.ts (the record page) over the fixture records and the contract run",
        ),
      ),
    ],
    [
      ACCOUNT_OUTPUT,
      renderAccount(
        generatedBy(
          SCRIPT,
          "web/src/lib/account/words.ts, league/attached-rows.ts and hosts/device-words.ts over shared/fixtures/inseason",
        ),
        {
          me: await answer<Account>("me.json"),
          devices: await answer<Device[]>("devices.json"),
          attached: await answer<AttachedLeague[]>("leagues-attached.json"),
        },
        instantOf(WEEK_CLOCK),
        ZONE,
      ),
    ],
    [
      ACCOUNT_DELETE_OUTPUT,
      renderAccountDelete(
        generatedBy(
          SCRIPT,
          "web/src/lib/account/delete-words.ts and delete-api.ts (confirmed) over shared/fixtures/inseason",
        ),
        await answer<Account>("me.json"),
      ),
    ],
    [
      REFERENCE_OUTPUT,
      await renderReference(
        generatedBy(
          SCRIPT,
          "web/src/lib/server/pages/adp.ts, routes/(run)/compare and web/src/lib/run/schedule-view.ts (the clubs, a club and the strength of schedule) over the two fixture runs",
        ),
      ),
    ],
    [
      COMPANION_OUTPUT,
      await renderCompanion(
        generatedBy(
          SCRIPT,
          "web/src/lib/companion (model.ts, the page and its room) with web/src/lib/room (call.ts, model.ts, words.ts, report/headline.ts) over the recorded replay in shared/fixtures/companion",
        ),
      ),
    ],
    [
      MOCK_OUTPUT,
      await renderMock(
        generatedBy(
          SCRIPT,
          "web/src/lib/room (SoloRoom with call.ts, model.ts, words.ts and mock-words.ts, setup/setup.ts, report/headline.ts) over the recorded draft in shared/fixtures/mock-room",
        ),
      ),
    ],
    ...(await renderOneValue(
      generatedBy(
        SCRIPT,
        "web/src/lib/run/live-order.ts, front/live-board.ts, player/live-figures.ts and formats-words.ts over the fixture order and a stand-in run made from it",
      ),
    )),
    [
      LOBBY_OUTPUT,
      await renderLobby(
        generatedBy(
          SCRIPT,
          "web/src/lib/room (LobbyRoomView with lobby.ts, lobby-words.ts, call.ts, model.ts, words.ts, setup/setup.ts, report/headline.ts) over the recorded lobby in shared/fixtures/lobby-room",
        ),
      ),
    ],
    [
      SHEET_OUTPUT,
      renderSheet(
        generatedBy(
          SCRIPT,
          "web/src/lib/sheet (csv.ts encodeCsv, tags.ts, status.ts statusWords, limits.ts) over the fixture sheet in sheet-parity.ts",
        ),
      ),
    ],
  ]);
}

if (import.meta.main) await writeOutputs(await generate());

/** The word tables' generator: the web's word tables, which every screen's words live in, into JSON
 * under shared/words and the apps' `Words` enum (iOS) and object (Android), so the apps print the
 * web's words. A function-valued member builds its words from data and cannot be copied: the JSON
 * names it under `functions`, so an app knows to port it, and the apps get no constant for it. A list
 * of strings (the delete page's Deleted and Kept lines) is copied as a list, in its order.
 *
 *   node shared/scripts/gen-words.ts
 *
 * The web's modules are imported as they are (Node strips their types). */
import {
  REPOSITORY,
  generatedBy,
  stringLiteral,
  writeOutputs,
  type Outputs,
} from "./generated.ts";
import { join } from "node:path";

/** A word table as the web exports it: strings, and functions that build words. */
export type WordTable = Readonly<Record<string, unknown>>;

export interface NamedTable {
  /** The table's name, the enum and object the apps read it from (`LeagueHome`, `Box`). */
  name: string;
  table: WordTable;
}

/** What a table takes from its module: an exported table whole (`'BOX'`), or one exported string
 * under the key the apps read it by (`['drop', 'DROP_WORD']`), for words the web keeps beside its
 * functions rather than in a table. */
export type Pick = string | readonly [key: string, exportName: string];

/** Where a table's words are taken from: a module and what it takes from it. */
interface TableFrom {
  module: string;
  picks: readonly Pick[];
}

/** One table the generator writes: its module, what it takes from it and the JSON it writes. Both
 * apps draw the same table (Lane 232, B224). */
interface TableSource extends TableFrom {
  name: string;
  json: string;
}

const SCRIPT = "shared/scripts/gen-words.ts";
const HOME_MODULE = "web/src/lib/league/home/home.ts";
const BOX_MODULE = "web/src/lib/league/box/box.ts";
const BASIS_MODULE = "web/src/lib/league/box/basis.ts";
const LINEUP_MODULE = "web/src/lib/league/box/lineup.ts";
const DESIGNATION_MODULE = "web/src/lib/format/designation.ts";
const WAIVERS_MODULE = "web/src/lib/league/box/waivers.ts";
const BOARD_MODULE = "web/src/lib/ui/board-words.ts";
const ORDER_WORDS_MODULE = "web/src/lib/order/words.ts";
const WEEK_MODULE = "web/src/lib/order/week.ts";
const RECORD_MODULE = "web/src/lib/run/record.ts";
const ACCOUNT_MODULE = "web/src/lib/account/words.ts";
const REFERENCE_MODULE = "web/src/lib/site/reference-words.ts";
const STRENGTH_MODULE = "web/src/lib/run/strength-words.ts";
const COMPANION_MODULE = "web/src/lib/companion/words.ts";
const DELETE_MODULE = "web/src/lib/account/delete-words.ts";

/** Every table the apps print from, the League home's first, then the box score's: its heads, the
 * scoring formats, the basis sentences' parts, the game heads, the moves' kinds, the standings'
 * tiebreak and waiver order, the platforms' names; then the Start screen's (Lane 180): the lineup's
 * strip and verb, the positions an opponent's rank is against, the move's confirmation, the in-season
 * screens' lines, a status in words and in a rank's few characters, and the figures' heads; then the
 * Matchup's (Lane 183): the words beside its box scores; then the Board's (Lane 182): its chips and heads,
 * its formats' chips, the Gap's definition, and the season pages' verbs; then the run's board on the Board
 * (Lane 190): a tier band's words, what its count counts, the run's stamp and a past bye's word; then the
 * Waivers' (Lane 186): its table, strip and drop panel, the heads' basis, the Stash group, the season
 * figures' heads and the strip's mark; then the Trades' (Lane 189): the trade table's words, the
 * picker's first choice and the close call's chip, and the builder's lines; then the player sheet's
 * and page's (Lane 192): a held page's words, the week tile's, the page's facts, the read's figures'
 * labels and the words in place of a read not ready; then the Rankings' and Our record's (Lane 194):
 * the order's table, its week's kickers and defenses, the page's purpose and name, the pool's counts,
 * and the record's words, its box's heads, the orders a week graded, the two records' words and a
 * pair's; then the Account's (Lane 198): the page's own words, the free season's plan card and end,
 * the leagues table's, the paired devices', the push switches', the page's foot and the address it
 * names; then the reference screens' (Lane 199): ADP's, Compare's with its failure and its same-player
 * sentence, the clubs' and a club's, the schedule grid's, and schedule strength's heads; then the
 * companion's (Lane 210): the followed draft's page, its start page and its signed-out words, the
 * rooms' call, pool, team and wall words it draws, the report's, and the League home's draft-day
 * entry; then the mock room's (Lane 213): its bar, the pool's row verbs, the setup's form, chips and
 * clocks, the report's verbs and a shared draft's; then the lobby's (Lane 229): the landing's cards,
 * the room's notices and leave question, the score bug, the seats strip and the report's verbs; then
 * one value at the order's clock (Lane 224, from Lane 220): the every-format table's rank head and
 * footnote, and the run's stamp on an in-season page that shows the run's rows, and how many of the
 * board's players one read of the order reaches; then the delete account's (Lane 237): the
 * page's words with what goes and what stays, and the account foot's verb. */
export const TABLES: readonly TableSource[] = [
  {
    name: "LeagueHome",
    module: HOME_MODULE,
    picks: ["HOME"],
    json: "shared/words/league-home.json",
  },
  {
    name: "Box",
    module: BOX_MODULE,
    picks: ["BOX"],
    json: "shared/words/league-box.json",
  },
  {
    name: "BoxFormat",
    module: BOX_MODULE,
    picks: ["FORMAT_WORDS"],
    json: "shared/words/league-box-format.json",
  },
  {
    name: "Basis",
    module: BASIS_MODULE,
    picks: [
      ["asOfKickoff", "AS_OF_KICKOFF"],
      ["projFinalPart", "PROJ_FINAL_PART"],
      ["noProjFinalPart", "NO_PROJ_FINAL_PART"],
      ["paceClause", "PACE_CLAUSE"],
      ["paceClauseShort", "PACE_CLAUSE_SHORT"],
      ["oppPart", "OPP_PART"],
      ["rankOppPart", "RANK_OPP_PART"],
      ["rankPart", "RANK_PART"],
      ["pickPart", "PICK_PART"],
      ["rankOppPhone", "RANK_OPP_PHONE"],
      ["oppPhone", "OPP_PHONE"],
      ["statsByWednesday", "STATS_BY_WEDNESDAY"],
      ["kickedOffPart", "KICKED_OFF_PART"],
      ["forRostered", "FOR_ROSTERED"],
    ],
    json: "shared/words/league-basis.json",
  },
  {
    name: "BestLineupFrom",
    module: BASIS_MODULE,
    picks: ["BEST_LINEUP_FROM"],
    json: "shared/words/league-best-lineup-from.json",
  },
  {
    name: "Kickoff",
    module: "web/src/lib/league/box/kickoff.ts",
    picks: ["KICKOFF"],
    json: "shared/words/league-kickoff.json",
  },
  {
    name: "MoveKind",
    module: HOME_MODULE,
    picks: ["KIND_WORDS", ["drop", "DROP_WORD"]],
    json: "shared/words/league-move-kind.json",
  },
  {
    name: "Tiebreak",
    module: HOME_MODULE,
    picks: ["TIEBREAK_WORDS"],
    json: "shared/words/league-tiebreak.json",
  },
  {
    name: "WaiverOrder",
    module: HOME_MODULE,
    picks: ["WAIVER_ORDER_WORDS"],
    json: "shared/words/league-waiver-order.json",
  },
  {
    name: "Platform",
    module: "web/src/lib/league/names.ts",
    picks: ["HOST_WORDS"],
    json: "shared/words/league-platform.json",
  },
  {
    name: "Shell",
    module: "web/src/lib/ui/shell-words.ts",
    picks: ["SHELL"],
    json: "shared/words/shell.json",
  },
  {
    name: "LeagueSwitch",
    module: "web/src/lib/context/menu-words.ts",
    picks: [
      ["followFirst", "FOLLOW_FIRST"],
      ["followAnother", "FOLLOW_ANOTHER"],
      ["tePremium", "TE_PREMIUM_WORDS"],
    ],
    json: "shared/words/shell-league-switch.json",
  },
  {
    name: "Scoring",
    module: "web/src/lib/league/names.ts",
    picks: ["SCORING_WORDS"],
    json: "shared/words/league-scoring.json",
  },
  {
    name: "FormatLabel",
    module: "web/src/lib/sheet/format.ts",
    picks: ["FORMAT_LABELS"],
    json: "shared/words/format-labels.json",
  },
  {
    name: "Shelf",
    module: "web/src/lib/player/shelf.ts",
    picks: ["SHELF"],
    json: "shared/words/player-shelf.json",
  },
  {
    name: "Card",
    module: "web/src/lib/player/card.ts",
    picks: ["CARD", ["none", "NONE"]],
    json: "shared/words/player-card.json",
  },
  {
    name: "Lineup",
    module: LINEUP_MODULE,
    picks: ["LINEUP"],
    json: "shared/words/league-lineup.json",
  },
  {
    name: "Against",
    module: LINEUP_MODULE,
    picks: ["AGAINST"],
    json: "shared/words/league-against.json",
  },
  {
    name: "Move",
    module: "web/src/lib/league/inseason/move.ts",
    picks: ["MOVE_LINES", ["notReached", "NOT_REACHED"]],
    json: "shared/words/league-move.json",
  },
  {
    name: "InSeason",
    module: "web/src/lib/league/inseason/words.ts",
    picks: ["LINES"],
    json: "shared/words/league-inseason.json",
  },
  {
    name: "Designation",
    module: DESIGNATION_MODULE,
    picks: ["DESIGNATION_WORDS"],
    json: "shared/words/designation.json",
  },
  {
    name: "DesignationRank",
    module: DESIGNATION_MODULE,
    picks: ["RANK_WORDS"],
    json: "shared/words/designation-rank.json",
  },
  {
    name: "Capture",
    module: DESIGNATION_MODULE,
    picks: ["CAPTURE_WORDS"],
    json: "shared/words/capture.json",
  },
  {
    name: "Figure",
    module: "web/src/lib/format/figure-words.ts",
    picks: ["FIGURE"],
    json: "shared/words/figure.json",
  },
  {
    name: "Matchup",
    module: "web/src/lib/league/box/matchup.ts",
    picks: ["MATCHUP"],
    json: "shared/words/league-matchup.json",
  },
  {
    name: "Board",
    module: BOARD_MODULE,
    picks: ["BOARD"],
    json: "shared/words/board.json",
  },
  {
    name: "BoardFormat",
    module: BOARD_MODULE,
    picks: ["BOARD_FORMAT_WORDS"],
    json: "shared/words/board-format.json",
  },
  {
    name: "BoardBasis",
    module: "web/src/lib/run/board-basis.ts",
    picks: [["gap", "GAP_WORDS"]],
    json: "shared/words/board-basis.json",
  },
  {
    name: "PageVerb",
    module: "web/src/lib/site/season-words.ts",
    picks: ["PAGE_VERBS"],
    json: "shared/words/page-verb.json",
  },
  {
    name: "Tier",
    module: "web/src/lib/ui/tier.ts",
    picks: ["TIER_WORDS"],
    json: "shared/words/tier.json",
  },
  {
    name: "TierGroup",
    module: "web/src/lib/run/derive.ts",
    picks: ["GROUP_WORDS"],
    json: "shared/words/tier-group.json",
  },
  {
    name: "RunStamp",
    module: "web/src/lib/run/stamp.ts",
    picks: ["STAMP_WORDS"],
    json: "shared/words/run-stamp.json",
  },
  {
    name: "Bye",
    module: "web/src/lib/format/bye.ts",
    picks: ["BYE_WORDS"],
    json: "shared/words/bye.json",
  },
  {
    name: "Waivers",
    module: WAIVERS_MODULE,
    picks: ["WAIVERS"],
    json: "shared/words/league-waivers.json",
  },
  {
    name: "WaiverHeads",
    module: WAIVERS_MODULE,
    picks: ["HEAD_BASIS", ["separator", "HEAD_SEPARATOR"]],
    json: "shared/words/league-waiver-heads.json",
  },
  {
    name: "Stash",
    module: WAIVERS_MODULE,
    picks: ["STASH"],
    json: "shared/words/league-stash.json",
  },
  {
    name: "Season",
    module: "web/src/lib/league/box/season.ts",
    picks: ["SEASON", ["gainAWeek", "GAIN_A_WEEK"]],
    json: "shared/words/league-season.json",
  },
  {
    name: "Strip",
    module: "web/src/lib/league/box/strip.ts",
    picks: ["STRIP"],
    json: "shared/words/league-strip.json",
  },
  {
    name: "Trades",
    module: "web/src/lib/league/box/trades.ts",
    picks: ["TRADES"],
    json: "shared/words/league-trades.json",
  },
  {
    name: "TradePicker",
    module: "web/src/lib/league/inseason/words.ts",
    picks: [
      ["every", "EVERY_TRADE"],
      ["closeForThem", "CLOSE_FOR_THEM"],
    ],
    json: "shared/words/league-trade-picker.json",
  },
  {
    name: "Builder",
    module: "web/src/lib/league/inseason/builder.ts",
    picks: ["BUILDER_LINES"],
    json: "shared/words/league-builder.json",
  },
  {
    name: "HeldPage",
    module: "web/src/lib/player/held-words.ts",
    picks: ["HELD_PAGE_WORDS"],
    json: "shared/words/player-held.json",
  },
  {
    name: "StatusHeld",
    module: "web/src/lib/player/status-words.ts",
    picks: ["STATUS_HELD_WORDS"],
    json: "shared/words/player-status-held.json",
  },
  {
    name: "WeekTile",
    module: "web/src/lib/player/week-words.ts",
    picks: ["WEEK_TILE"],
    json: "shared/words/player-week-tile.json",
  },
  {
    name: "PlayerPage",
    module: "web/src/lib/player/page-words.ts",
    picks: ["PLAYER_PAGE"],
    json: "shared/words/player-page.json",
  },
  {
    name: "ReadFigures",
    module: "web/src/lib/run/read-figures.ts",
    picks: [
      ["preseasonProjection", "PRESEASON_PROJECTION"],
      ["preseasonTiers", "PRESEASON_TIERS"],
      ["restOfSeason", "REST_OF_SEASON"],
    ],
    json: "shared/words/player-read-figures.json",
  },
  {
    name: "Unwritten",
    module: "web/src/lib/run/unwritten-words.ts",
    picks: [["read", "UNWRITTEN_READ"]],
    json: "shared/words/player-unwritten.json",
  },
  {
    name: "Order",
    module: ORDER_WORDS_MODULE,
    picks: ["ORDER"],
    json: "shared/words/order.json",
  },
  {
    name: "OrderWeek",
    module: ORDER_WORDS_MODULE,
    picks: ["WEEK"],
    json: "shared/words/order-week.json",
  },
  {
    name: "PagePurpose",
    module: ORDER_WORDS_MODULE,
    picks: ["PAGE_PURPOSE"],
    json: "shared/words/page-purpose.json",
  },
  {
    name: "WeekTab",
    module: WEEK_MODULE,
    picks: ["WEEK_TAB"],
    json: "shared/words/order-week-tab.json",
  },
  {
    name: "DefenseScoring",
    module: WEEK_MODULE,
    picks: ["DEFENSE_SCORING"],
    json: "shared/words/order-defense-scoring.json",
  },
  {
    name: "WeekMany",
    module: "web/src/lib/order/week-head.ts",
    picks: ["WEEK_MANY", ["thisWeek", "THIS_WEEK"]],
    json: "shared/words/order-week-many.json",
  },
  {
    name: "PageName",
    module: "web/src/lib/run/week-names.ts",
    picks: ["PAGE_NAME_WORDS"],
    json: "shared/words/page-name.json",
  },
  {
    name: "Pool",
    module: "web/src/lib/format/pool-words.ts",
    picks: ["POOL"],
    json: "shared/words/pool.json",
  },
  {
    name: "Record",
    module: RECORD_MODULE,
    picks: ["RECORD_WORDS"],
    json: "shared/words/record.json",
  },
  {
    name: "RecordBox",
    module: RECORD_MODULE,
    picks: ["RECORD_BOX"],
    json: "shared/words/record-box.json",
  },
  {
    name: "RecordOrder",
    module: RECORD_MODULE,
    picks: ["ORDER_WORDS"],
    json: "shared/words/record-order.json",
  },
  {
    name: "Records",
    module: "web/src/lib/run/records.ts",
    picks: ["RECORDS_WORDS"],
    json: "shared/words/records.json",
  },
  {
    name: "Pair",
    module: "web/src/lib/run/record-pair.ts",
    picks: ["PAIR_WORDS"],
    json: "shared/words/record-pair.json",
  },
  {
    name: "Account",
    module: ACCOUNT_MODULE,
    picks: ["ACCOUNT_WORDS"],
    json: "shared/words/account.json",
  },
  {
    name: "FreePlan",
    module: ACCOUNT_MODULE,
    picks: ["FREE_PLAN_WORDS", ["see", "FREE_SEE"]],
    json: "shared/words/account-free-plan.json",
  },
  {
    name: "Attached",
    module: "web/src/lib/league/attached-rows.ts",
    picks: ["ATTACHED_WORDS"],
    json: "shared/words/account-attached.json",
  },
  {
    name: "Devices",
    module: "web/src/lib/hosts/device-words.ts",
    picks: ["DEVICES"],
    json: "shared/words/account-devices.json",
  },
  {
    name: "Push",
    module: "web/src/lib/account/push-words.ts",
    picks: ["PUSH"],
    json: "shared/words/account-push.json",
  },
  {
    name: "AccountFoot",
    module: "web/src/lib/account/foot-words.ts",
    picks: ["ACCOUNT_FOOT"],
    json: "shared/words/account-foot.json",
  },
  {
    name: "Support",
    module: "web/src/lib/legal/contact.ts",
    picks: [["email", "SUPPORT_EMAIL"]],
    json: "shared/words/account-support.json",
  },
  {
    name: "FreeSeason",
    module: "web/src/lib/pass/free-season.ts",
    picks: [["ends", "FREE_SEASON_ENDS"]],
    json: "shared/words/account-free-season.json",
  },
  {
    name: "AdpPage",
    module: REFERENCE_MODULE,
    picks: ["ADP_PAGE"],
    json: "shared/words/reference-adp.json",
  },
  {
    name: "ComparePage",
    module: REFERENCE_MODULE,
    picks: ["COMPARE_PAGE"],
    json: "shared/words/reference-compare.json",
  },
  {
    name: "Compare",
    module: "web/src/lib/site/compare-words.ts",
    picks: [["failed", "COMPARE_FAILED"]],
    json: "shared/words/compare.json",
  },
  {
    name: "Verdict",
    module: "web/src/lib/site/verdict.ts",
    picks: [["samePlayer", "SAME_PLAYER"]],
    json: "shared/words/verdict.json",
  },
  {
    name: "ClubPage",
    module: REFERENCE_MODULE,
    picks: ["CLUB_PAGE"],
    json: "shared/words/reference-club.json",
  },
  {
    name: "SchedulePage",
    module: REFERENCE_MODULE,
    picks: ["SCHEDULE_PAGE"],
    json: "shared/words/reference-schedule.json",
  },
  {
    name: "Strength",
    module: STRENGTH_MODULE,
    picks: ["STRENGTH_HEADS"],
    json: "shared/words/strength.json",
  },
  {
    name: "StrengthColumn",
    module: STRENGTH_MODULE,
    picks: ["STRENGTH_COLUMNS"],
    json: "shared/words/strength-column.json",
  },
  {
    name: "Companion",
    module: COMPANION_MODULE,
    picks: ["COMPANION"],
    json: "shared/words/companion.json",
  },
  {
    name: "CompanionNew",
    module: COMPANION_MODULE,
    picks: ["COMPANION_NEW"],
    json: "shared/words/companion-new.json",
  },
  {
    name: "CompanionSignedOut",
    module: "web/src/lib/companion/new-words.ts",
    picks: ["SIGNED_OUT_WORDS"],
    json: "shared/words/companion-signed-out.json",
  },
  {
    name: "Room",
    module: "web/src/lib/room/words.ts",
    picks: ["ROOM"],
    json: "shared/words/room.json",
  },
  {
    name: "Report",
    module: "web/src/lib/room/report/headline.ts",
    picks: ["REPORT"],
    json: "shared/words/report.json",
  },
  {
    name: "DraftDay",
    module: "web/src/lib/league/phase-words.ts",
    picks: [
      ["advisorVerb", "ADVISOR_VERB"],
      ["turnsAfterDraft", "TURNS_AFTER_DRAFT"],
    ],
    json: "shared/words/draft-day.json",
  },
  {
    name: "Mock",
    module: "web/src/lib/room/mock-words.ts",
    picks: ["MOCK"],
    json: "shared/words/mock.json",
  },
  {
    name: "MockSetup",
    module: "web/src/lib/room/setup/setup.ts",
    picks: ["SETUP_CHOICES"],
    json: "shared/words/mock-setup.json",
  },
  {
    name: "MockClocks",
    module: "web/src/lib/room/setup/setup.ts",
    picks: ["SETUP_CELLS"],
    json: "shared/words/mock-clocks.json",
  },
  {
    name: "FormatsRank",
    module: "web/src/lib/player/formats-words.ts",
    picks: ["FORMATS_RANK"],
    json: "shared/words/formats-rank.json",
  },
  {
    name: "LiveStrip",
    module: "web/src/lib/front/live-board.ts",
    picks: ["STRIP_WORDS"],
    json: "shared/words/live-strip.json",
  },
  {
    name: "LiveOrder",
    module: "web/src/lib/run/live-order.ts",
    picks: ["LIVE_ORDER_WORDS"],
    json: "shared/words/live-order.json",
  },
  {
    name: "ClubOrder",
    module: REFERENCE_MODULE,
    picks: ["CLUB_ORDER"],
    json: "shared/words/club-order.json",
  },
  {
    name: "Lobby",
    module: "web/src/lib/room/lobby-words.ts",
    picks: ["LOBBY"],
    json: "shared/words/lobby.json",
  },
  {
    name: "DeleteAccount",
    module: DELETE_MODULE,
    picks: ["DELETE_WORDS"],
    json: "shared/words/account-delete.json",
  },
  {
    name: "AccountDeleteFoot",
    module: DELETE_MODULE,
    picks: ["ACCOUNT_DELETE_FOOT"],
    json: "shared/words/account-delete-foot.json",
  },
];
export const OUTPUT = {
  swift:
    "apps/ios/Packages/CommishDesign/Sources/CommishDesign/Words.generated.swift",
  kotlin: "apps/android/design/src/main/kotlin/app/trycommish/design/Words.kt",
} as const;

const SWIFT_KEYWORDS = new Set(
  `associatedtype class deinit enum extension fileprivate func import init inout internal let open
	operator private precedencegroup protocol public rethrows static struct subscript typealias var
	break case catch continue default defer do else fallthrough for guard if in repeat return throw
	switch where while Any as await false is nil self Self super throws true try`.split(
    /\s+/,
  ),
);
const KOTLIN_KEYWORDS = new Set(
  `as break class continue do else false for fun if in interface is null object package return
	super this throw true try typealias typeof val var when while`.split(/\s+/),
);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Split {
  strings: [string, string][];
  lists: [string, readonly string[]][];
  functions: string[];
}

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/** The table's strings, its lists of strings and its functions' names, or an error naming the member
 * that is none of them. */
function split(table: WordTable, name: string): Split {
  const strings: [string, string][] = [];
  const lists: [string, readonly string[]][] = [];
  const functions: string[] = [];
  for (const [key, value] of Object.entries(table)) {
    if (!IDENTIFIER.test(key))
      throw new Error(`${name}.${key} is not an identifier the apps can use.`);
    if (typeof value === "string") strings.push([key, value]);
    else if (isStringList(value)) lists.push([key, value]);
    else if (typeof value === "function") functions.push(key);
    else
      throw new Error(
        `${name}.${key} is a ${typeof value}, not a string, a list of strings or a function.`,
      );
  }
  return { strings, lists, functions };
}

/** One table's JSON: each string and each list by its key, in the table's order, then the function
 * members' names. */
export function renderTable(table: WordTable, name: string): { json: string } {
  const { functions } = split(table, name);
  const copied = Object.entries(table).filter(
    ([, value]) => typeof value !== "function",
  );
  return {
    json: `${JSON.stringify({ ...Object.fromEntries(copied), functions }, null, "\t")}\n`,
  };
}

const swiftKey = (key: string): string =>
  SWIFT_KEYWORDS.has(key) ? `\`${key}\`` : key;
const kotlinKey = (key: string): string =>
  KOTLIN_KEYWORDS.has(key) ? `\`${key}\`` : key;

/** Every table into one Swift file and one Kotlin file. */
export function renderWords(tables: readonly NamedTable[]): {
  swift: string;
  kotlin: string;
} {
  const parts = tables.map(({ name, table }) => ({
    name,
    ...split(table, name),
  }));
  const swift = parts
    .map(
      ({ name, strings, lists }) =>
        `    public enum ${name} {\n${[
          ...strings.map(
            ([key, text]) =>
              `        public static let ${swiftKey(key)} = ${stringLiteral(text, "swift")}`,
          ),
          ...lists.map(
            ([key, items]) =>
              `        public static let ${swiftKey(key)}: [String] = [${items.map((text) => stringLiteral(text, "swift")).join(", ")}]`,
          ),
        ].join("\n")}\n    }`,
    )
    .join("\n\n");
  const kotlin = parts
    .map(
      ({ name, strings, lists }) =>
        `    object ${name} {\n${[
          ...strings.map(
            ([key, text]) =>
              `        const val ${kotlinKey(key)} = ${stringLiteral(text, "kotlin")}`,
          ),
          ...lists.map(
            ([key, items]) =>
              `        val ${kotlinKey(key)}: List<String> = listOf(${items.map((text) => stringLiteral(text, "kotlin")).join(", ")})`,
          ),
        ].join("\n")}\n    }`,
    )
    .join("\n\n");
  const source =
    tables.length === 1 ? "the web word table" : "the web word tables";
  return {
    swift: `// ${generatedBy(SCRIPT, source)}
// swiftlint:disable all

/// The web's words, one enum per web word table. A word built from data is a function on the web, is
/// listed under \`functions\` in shared/words, not here, and is a function in the app too.
public enum Words {
${swift}
}
`,
    kotlin: `// ${generatedBy(SCRIPT, source)}
@file:Suppress("ktlint")

package app.trycommish.design

/** The web's words, one object per web word table. A word built from data is a function on the web, is
 * listed under \`functions\` in shared/words, not here, and is a function in the app too. */
object Words {
${kotlin}
}
`,
  };
}

/** One table from a module's exports by its picks, or an error naming the export that is missing,
 * not the kind its pick says, or a key given twice. */
export function gather(
  module: Readonly<Record<string, unknown>>,
  picks: readonly Pick[],
  where: string,
): WordTable {
  const entries = picks.flatMap((pick): [string, unknown][] => {
    const exportName = typeof pick === "string" ? pick : pick[1];
    if (!(exportName in module))
      throw new Error(`${where} exports no ${exportName}.`);
    const value = module[exportName];
    if (typeof pick !== "string") {
      if (typeof value !== "string")
        throw new Error(
          `${where} ${exportName} is a ${typeof value}, not a string.`,
        );
      return [[pick[0], value]];
    }
    if (typeof value !== "object" || value === null)
      throw new Error(
        `${where} ${exportName} is a ${typeof value}, not a table.`,
      );
    return Object.entries(value);
  });
  const twice = entries.find(
    ([key], i) => entries.findIndex(([other]) => other === key) !== i,
  );
  if (twice !== undefined) throw new Error(`${where} gives ${twice[0]} twice.`);
  return Object.fromEntries(entries);
}

async function readTable(name: string, from: TableFrom): Promise<NamedTable> {
  const module = (await import(join(REPOSITORY, from.module))) as Record<
    string,
    unknown
  >;
  return { name, table: gather(module, from.picks, from.module) };
}

export async function generate(): Promise<Outputs> {
  const tables = await Promise.all(
    TABLES.map((source) => readTable(source.name, source)),
  );
  const { swift, kotlin } = renderWords(tables);
  return new Map([
    ...TABLES.map((source, i): [string, string] => [
      source.json,
      renderTable(tables[i]?.table ?? {}, source.name).json,
    ]),
    [OUTPUT.swift, swift],
    [OUTPUT.kotlin, kotlin],
  ]);
}

if (import.meta.main) await writeOutputs(await generate());

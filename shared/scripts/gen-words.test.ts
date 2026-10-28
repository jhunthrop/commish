// The word tables' generator: a web word table into its JSON, the iOS `Words` enum and the Android
// `Words` object. Run with `node --test shared/scripts/*.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OUTPUT,
  TABLES,
  gather,
  generate,
  renderWords,
  renderTable,
} from "./gen-words.ts";

const TABLE = {
  week: "Week",
  noMoves: "No moves yet",
  f: (x: number): number => x,
};

void test("the JSON: every string as is, every function named under functions", () => {
  assert.deepEqual(JSON.parse(renderTable(TABLE, "Tiny").json), {
    week: "Week",
    noMoves: "No moves yet",
    functions: ["f"],
  });
});

void test("the Swift and Kotlin: one constant per string, inside the table named for its screen", () => {
  const { swift, kotlin } = renderWords([{ name: "LeagueHome", table: TABLE }]);
  assert.match(swift, /public enum Words \{\s*public enum LeagueHome \{/);
  assert.match(swift, /public static let noMoves = "No moves yet"/);
  assert.doesNotMatch(swift, /\bf\b =/);
  assert.match(kotlin, /^package app\.trycommish\.design$/m);
  assert.match(kotlin, /object Words \{\s*object LeagueHome \{/);
  assert.match(kotlin, /const val noMoves = "No moves yet"/);
});

void test("a quote, a backslash, a newline and a dollar are escaped in both languages", () => {
  const { swift, kotlin } = renderWords([
    { name: "Odd", table: { said: 'He said "go"\nthen $5 \\ more' } },
  ]);
  assert.ok(
    swift.includes(
      'public static let said = "He said \\"go\\"\\nthen $5 \\\\ more"',
    ),
    swift,
  );
  assert.ok(
    kotlin.includes(
      'const val said = "He said \\"go\\"\\nthen \\$5 \\\\ more"',
    ),
    kotlin,
  );
});

void test("a key that is the language's keyword is quoted the language's way", () => {
  const { swift, kotlin } = renderWords([
    { name: "K", table: { when: "When", default: "Default" } },
  ]);
  assert.match(kotlin, /const val `when` = "When"/);
  assert.match(swift, /public static let `default` = "Default"/);
});

void test("a member that is neither a string, a list of strings nor a function fails with its key named", () => {
  assert.throws(() => renderTable({ n: 3 }, "Bad"), /Bad\.n/);
  assert.throws(() => renderTable({ mixed: ["a", 3] }, "Bad"), /Bad\.mixed/);
});

void test("a list of strings is copied as a list, in order, in the JSON, the Swift and the Kotlin", () => {
  const table = { head: "Deleted", lines: ["Your sheets", 'Your "mocks"'] };
  assert.deepEqual(JSON.parse(renderTable(table, "Gone").json), {
    head: "Deleted",
    lines: ["Your sheets", 'Your "mocks"'],
    functions: [],
  });
  const { swift, kotlin } = renderWords([{ name: "Gone", table }]);
  assert.ok(
    swift.includes(
      'public static let lines: [String] = ["Your sheets", "Your \\"mocks\\""]',
    ),
    swift,
  );
  assert.ok(
    kotlin.includes(
      'val lines: List<String> = listOf("Your sheets", "Your \\"mocks\\"")',
    ),
    kotlin,
  );
});

void test("a table gathered from a module: an object export spread, a string export under its key", () => {
  const module = {
    KINDS: { add: "Free agent", trade: "Trade" },
    DROP_WORD: "Drop",
  };
  assert.deepEqual(gather(module, ["KINDS", ["drop", "DROP_WORD"]], "m.ts"), {
    add: "Free agent",
    trade: "Trade",
    drop: "Drop",
  });
});

void test("gathering fails on an export missing, a keyed export not a string and a key twice", () => {
  assert.throws(() => gather({}, ["BOX"], "m.ts"), /m\.ts exports no BOX/);
  assert.throws(
    () => gather({ N: 3 }, [["n", "N"]], "m.ts"),
    /m\.ts N is a number, not a string/,
  );
  assert.throws(
    () => gather({ T: "x" }, ["T"], "m.ts"),
    /m\.ts T is a string, not a table/,
  );
  assert.throws(
    () =>
      gather({ A: { drop: "Drop" }, D: "Drop" }, ["A", ["drop", "D"]], "m.ts"),
    /m\.ts gives drop twice/,
  );
});

void test("several tables: each its own enum and object inside Words, in the order listed", () => {
  const { swift, kotlin } = renderWords([
    { name: "Box", table: { proj: "Proj" } },
    { name: "Platform", table: { espn: "ESPN" } },
  ]);
  assert.match(
    swift,
    /public enum Box \{\s*public static let proj = "Proj"\s*\}\s*public enum Platform \{/,
  );
  assert.match(
    kotlin,
    /object Box \{\s*const val proj = "Proj"\s*\}\s*object Platform \{/,
  );
});

void test("the tables: the League home's, the box score's, then the shell's and the player shelf's, each with its own JSON", () => {
  assert.deepEqual(
    TABLES.map((t) => t.name),
    [
      "LeagueHome",
      "Box",
      "BoxFormat",
      "Basis",
      "BestLineupFrom",
      "Kickoff",
      "MoveKind",
      "Tiebreak",
      "WaiverOrder",
      "Platform",
      "Shell",
      "LeagueSwitch",
      "Scoring",
      "FormatLabel",
      "Shelf",
      "Card",
      "Lineup",
      "Against",
      "Move",
      "InSeason",
      "Designation",
      "DesignationRank",
      "Figure",
      "Matchup",
      "Board",
      "BoardFormat",
      "BoardBasis",
      "PageVerb",
      "Tier",
      "TierGroup",
      "RunStamp",
      "Bye",
      "Waivers",
      "WaiverHeads",
      "Stash",
      "Season",
      "Strip",
      "Trades",
      "TradePicker",
      "Builder",
      "HeldPage",
      "StatusHeld",
      "WeekTile",
      "PlayerPage",
      "ReadFigures",
      "Unwritten",
      "Order",
      "OrderWeek",
      "PagePurpose",
      "WeekTab",
      "DefenseScoring",
      "WeekMany",
      "PageName",
      "Pool",
      "Record",
      "RecordBox",
      "RecordOrder",
      "Records",
      "Pair",
      "Account",
      "FreePlan",
      "Attached",
      "Devices",
      "Push",
      "AccountFoot",
      "Support",
      "FreeSeason",
      "AdpPage",
      "ComparePage",
      "Compare",
      "Verdict",
      "ClubPage",
      "SchedulePage",
      "Strength",
      "StrengthColumn",
      "Companion",
      "CompanionNew",
      "CompanionSignedOut",
      "Room",
      "Report",
      "DraftDay",
      "Mock",
      "MockSetup",
      "MockClocks",
      "FormatsRank",
      "LiveStrip",
      "LiveOrder",
      "ClubOrder",
      "Lobby",
      "DeleteAccount",
      "AccountDeleteFoot",
    ],
  );
  assert.equal(new Set(TABLES.map((t) => t.json)).size, TABLES.length);
});

void test("the web's own words land in the JSON, the Swift and the Kotlin", async () => {
  const outputs = await generate();
  const json = (path: string): Record<string, unknown> =>
    JSON.parse(outputs.get(path) ?? "{}") as Record<string, unknown>;
  assert.equal(json("shared/words/league-box.json").totals, "Team");
  assert.equal(json("shared/words/account-attached.json").detach, "Detach");
  assert.deepEqual(json("shared/words/account-devices.json").functions, []);
  assert.equal(
    json("shared/words/account-free-plan.json").see,
    "See what's free",
  );
  assert.equal(
    json("shared/words/account-support.json").email,
    "help@trycommish.app",
  );
  assert.equal(
    json("shared/words/account-free-season.json").ends,
    "2027-03-01T00:00:00Z",
  );
  assert.equal(
    json("shared/words/shell-league-switch.json").followAnother,
    "Follow another league",
  );
  assert.equal(
    json("shared/words/account-attached.json").followFirst,
    undefined,
  );
  assert.equal(
    json("shared/words/league-platform.json").mfl,
    "MyFantasyLeague",
  );
  assert.equal(json("shared/words/league-move-kind.json").drop, "Drop");
  assert.equal(
    json("shared/words/league-basis.json").paceClauseShort,
    "in-play players at pace",
  );
  assert.equal(json("shared/words/shell.json").searchPlayers, "Search players");
  assert.equal(
    json("shared/words/shell-league-switch.json").followFirst,
    "Follow your league",
  );
  assert.equal(json("shared/words/player-shelf.json").fullPage, "Full page");
  assert.equal(json("shared/words/league-scoring.json").half_ppr, "half PPR");
  assert.equal(
    json("shared/words/board.json").heldHead,
    "On a season-long list, his figures assume he plays",
  );
  assert.equal(json("shared/words/board-format.json").half, "Half PPR");
  assert.equal(json("shared/words/page-verb.json").mock, "Start a mock draft");
  assert.equal(
    json("shared/words/league-trades.json").proposeItOn,
    "Propose it on",
  );
  assert.equal(
    json("shared/words/league-trade-picker.json").every,
    "Every trade",
  );
  assert.equal(json("shared/words/league-builder.json").open, "Build a trade");
  assert.match(
    String(json("shared/words/board-basis.json").gap),
    /^Gap, drafters' ADP less our rank/,
  );
  assert.equal(json("shared/words/player-card.json").none, "--");
  assert.equal(
    json("shared/words/league-waivers.json").noGain,
    "No gain over your roster",
  );
  assert.equal(
    json("shared/words/league-stash.json").backNow,
    "Back this week",
  );
  assert.deepEqual(json("shared/words/league-stash.json").functions, [
    "back",
    "taken",
  ]);
  assert.equal(json("shared/words/league-waiver-heads.json").separator, ", ");
  assert.equal(
    json("shared/words/league-season.json").gainAWeek,
    "Gain a week",
  );
  assert.equal(
    json("shared/words/player-held.json").log,
    "His game log is not written yet.",
  );
  assert.equal(
    json("shared/words/player-week-tile.json").sinceRead,
    "since our read was written",
  );
  assert.deepEqual(json("shared/words/player-week-tile.json").functions, [
    "atRead",
  ]);
  assert.equal(
    json("shared/words/player-page.json").outcomes,
    "Floor, median, ceiling",
  );
  assert.equal(
    json("shared/words/player-read-figures.json").preseasonTiers,
    "Preseason tiers",
  );
  const swift = outputs.get(OUTPUT.swift) ?? "";
  const kotlin = outputs.get(OUTPUT.kotlin) ?? "";
  assert.match(
    swift,
    /public enum Tiebreak \{[^}]*public static let head_to_head = "head to head"/,
  );
  assert.match(kotlin, /object Kickoff \{[^}]*const val decided = "Decided"/);
});

/** Each table's members as one language's file names them, by the table's name: its constants and its
 * lists, a keyword's quotes dropped. A table opens on its own line inside Words and each member is a
 * line of its own, so the lines are read, never the braces (a word may carry "{name}"). */
function membersOf(
  source: string,
  table: RegExp,
  member: RegExp,
): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let members: string[] | null = null;
  for (const line of source.split("\n")) {
    const opened = table.exec(line);
    if (opened) {
      members = [];
      found.set(opened[1] ?? "", members);
      continue;
    }
    const key = member.exec(line)?.[1];
    if (members !== null && key !== undefined)
      members.push(key.replaceAll("`", ""));
  }
  return found;
}

void test("every table renders the same members in the Swift and the Kotlin (Lane 231 review L1)", async () => {
  const outputs = await generate();
  const swift = membersOf(
    outputs.get(OUTPUT.swift) ?? "",
    /^ {4}public enum (\w+) \{/,
    /^ {8}public static let (`?\w+`?)/,
  );
  const kotlin = membersOf(
    outputs.get(OUTPUT.kotlin) ?? "",
    /^ {4}object (\w+) \{/,
    /^ {8}(?:const )?val (`?\w+`?)/,
  );
  assert.deepEqual(
    [...swift.keys()],
    TABLES.map((source) => source.name),
  );
  assert.deepEqual([...kotlin.keys()], [...swift.keys()]);
  for (const [name, members] of swift)
    assert.deepEqual(
      kotlin.get(name),
      members,
      `${name} differs between the apps`,
    );
  // The two tables the apps once drew apart (Lane 223's seam): the web's words in both.
  assert.deepEqual(swift.get("Bye"), ["notSet"]);
  assert.ok(swift.get("Records")?.includes("setRulePhone"));
});

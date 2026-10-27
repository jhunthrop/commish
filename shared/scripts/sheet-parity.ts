/** The cheat sheet's parity (Lane 254): what the web's sheet writes and says over a fixture sheet, as
 * JSON the apps' Sheet screens are held to. The CSV the web's export writes for the fixture rows
 * (sheet/csv.ts encodeCsv), which the API's export (api/internal/sheets/csv.go EncodeCSV) is held to
 * byte for byte by its own test, so the file a phone shares is the file the site downloads; the fixed
 * tags with their chips' words and tones, a tag tap on a row's tags (tags.ts toggledTags), why a typed
 * tag is refused (tagProblem) and its stored spelling (canonicalTag); the status line beside the
 * sheet's name for every state the apps draw (status.ts statusWords), at instants and in a zone that
 * read the same on every machine; the sheet's bounds and its first name. Written by export-parity.ts
 * beside the others. */
import { encodeCsv } from "../../web/src/lib/sheet/csv.ts";
import {
  DEFAULT_SHEET_NAME,
  SHEET_LIMITS,
} from "../../web/src/lib/sheet/limits.ts";
import type { SheetRow } from "../../web/src/lib/sheet/model.ts";
import {
  statusWords,
  type StatusFacts,
} from "../../web/src/lib/sheet/status.ts";
import {
  FIXED_TAGS,
  canonicalTag,
  tagLabel,
  tagProblem,
  tagTone,
  toggledTags,
} from "../../web/src/lib/sheet/tags.ts";

export const SHEET_OUTPUT = "shared/fixtures/parity/sheet.json";

/** The fixture sheet: every cell the CSV quotes or defuses (a comma, a quote, a line break, a lead a
 * spreadsheet runs as a formula), every empty cell, a fixed and an own tag, Avoid's tone, a defense
 * and a kicker. Faces are left out: the file carries none. */
export const SHEET_ROWS: readonly SheetRow[] = [
  row(
    "4362628",
    "Ja'Marr Chase",
    "WR",
    "CIN",
    1,
    ["target"],
    "Round one, no thinking.",
  ),
  row(
    "4430807",
    "Bijan Robinson",
    "RB",
    "ATL",
    1,
    ["sleeper", "PPR bump"],
    'Says "workhorse", I agree',
  ),
  row("4431299", "Rome Odunze", "WR", "CHI", 2, [], "Two lines.\nSecond line."),
  row(
    "3139477",
    "Patrick Mahomes",
    "QB",
    "KC",
    null,
    ["avoid", "injury"],
    "=SUM(A1)",
  ),
  row(
    "4239996",
    "Travis Etienne Jr.",
    "RB",
    "JAX",
    3,
    ["handcuff"],
    "-3 last week",
  ),
  row("4689114", "Jaxson Dart", "QB", "NYG", null, [], null),
  row(
    "dst-BUF",
    "Buffalo Bills",
    "DST",
    "BUF",
    null,
    ["breakout"],
    "+ upside at home",
  ),
  row("3054850", "Brandon Aubrey", "K", null, null, [], "@ the dome"),
];

function row(
  id: string,
  name: string,
  position: SheetRow["position"],
  team: string | null,
  tier: number | null,
  tags: readonly string[],
  note: string | null,
): SheetRow {
  return { id, name, position, team, headshot: null, tier, tags, note };
}

/** A tag tapped on a row's tags: on, off, in place of its opposite, refused on a full row, and a typed
 * tag in another case or spacing read as the one it spells. */
const TOGGLES: readonly { tags: readonly string[]; tag: string }[] = [
  { tags: [], tag: "target" },
  { tags: ["target"], tag: "target" },
  { tags: ["target"], tag: "avoid" },
  { tags: ["avoid", "sleeper"], tag: "target" },
  { tags: ["target", "sleeper", "breakout", "injury"], tag: "handcuff" },
  { tags: ["target", "sleeper", "breakout", "injury"], tag: "avoid" },
  { tags: [], tag: "TARGET" },
  { tags: [], tag: "  late   round " },
  { tags: ["Late round"], tag: "late ROUND" },
  { tags: ["sleeper"], tag: "Rookie" },
];

/** Typed tags: kept, too long, a lead that is not a letter or digit, a separator, an apostrophe, an
 * accent, and nothing. */
const TYPED = [
  "ok tag",
  "x".repeat(21),
  "-late",
  "one,two",
  "Rookie's",
  "Élite",
  "",
  "Sleeper",
];

/** A change on Oct 13 at noon Eastern and an answer ten days on: no zone reads them as one day, so the
 * saved words name the day wherever this runs (the time of a save today is the reader's own clock, held
 * by the apps' own tests). */
const CHANGED = "2026-10-13T16:00:00.000Z";
const ANSWERED = new Date("2026-10-23T16:00:00.000Z");

const STATUSES: readonly StatusFacts[] = [
  facts("saving", null, CHANGED, 8),
  facts("saved", null, null, 8),
  facts("saved", null, CHANGED, 8),
  facts("failed", "This sheet changed on another device", CHANGED, 8),
  facts("failed", null, CHANGED, 8),
  facts("failed", "Some of that did not check out", null, 0),
  facts("saving", null, null, 0),
  facts("saved", null, CHANGED, 0),
];

function facts(
  status: StatusFacts["status"],
  problem: string | null,
  changedAt: string | null,
  players: number,
): StatusFacts {
  return { status, problem, changedAt, answeredAt: ANSWERED, players };
}

export function renderSheet(about: string): string {
  const sheet = {
    about,
    defaultName: DEFAULT_SHEET_NAME,
    limits: SHEET_LIMITS,
    rows: SHEET_ROWS,
    csv: encodeCsv(SHEET_ROWS),
    fixedTags: FIXED_TAGS.map(({ tag, label }) => ({
      tag,
      label,
      tone: tagTone(tag),
    })),
    labels: ["target", "avoid", "PPR bump"].map((tag) => ({
      tag,
      label: tagLabel(tag),
      tone: tagTone(tag),
    })),
    toggles: TOGGLES.map(({ tags, tag }) => ({
      tags,
      tag,
      after: toggledTags(tags, tag),
    })),
    typed: TYPED.map((tag) => ({
      tag,
      canonical: canonicalTag(tag),
      problem: tagProblem(canonicalTag(tag)),
    })),
    answeredAt: ANSWERED.toISOString(),
    statuses: STATUSES.map((status) => ({
      status: status.status,
      problem: status.problem,
      changedAt: status.changedAt,
      players: status.players,
      words: statusWords(status),
    })),
  };
  return `${JSON.stringify(sheet, null, "\t")}\n`;
}

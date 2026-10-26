/** The words the apps still draw where the web has moved on, so their generated words and their parity
 * stay what the apps draw until their own lane follows (Lane 223, B224). Each entry names the web's
 * change; the app lane deletes the entry (and this file with its last one), points gen-words.ts and
 * the parity scripts back at the web's tables and regenerates. apps-pending-words.test.ts fails when
 * an entry says what the web says again, so a stale entry is found, not kept.
 *
 * - The record's graded order (B188): the web names it "our rest-of-season order, graded week by
 *   week"; the apps' RecordLines still build "Our weekly rankings" by hand, so their words and the
 *   record parity keep the old sentences here.
 * - A played bye (B190): the web's Bye cell draws nothing; the apps' BoardCells still say "Bye Done",
 *   so their bye words and the board parity keep "Done" here. */
import {
  BYE_WORDS as WEB_BYE_WORDS,
  byeAhead,
} from "../../web/src/lib/format/bye.ts";
import {
  RECORDS_WORDS as WEB_RECORDS_WORDS,
  type RecordsWords,
} from "../../web/src/lib/run/records.ts";

const YARDSTICKS = "ESPN and the week's published projection";

/** The record's sentences the apps still draw, each one the web has changed. */
export const RECORDS_PENDING = {
  lead: `Two records, each graded against what it competes with: our weekly rankings against ${YARDSTICKS}, and our draft board against ADP.`,
  weeklyWhat: `Our weekly rankings against ${YARDSTICKS}`,
  before: (from: number) =>
    `Weekly rankings start week ${String(from)}. Each week's rankings are set before its first kickoff and graded as set, never as refreshed after, so a player put on IR later keeps the rank we set. Before that the site shipped the draft board, graded under ${WEB_RECORDS_WORDS.draft}.`,
  setRulePhone:
    "Each week's rankings are graded as set, never as refreshed after.",
  frontWeekly: (span: string, players: string) =>
    `Our weekly rankings over ${span}, ${players}.`,
  frontWeeklyNext: (week: number) =>
    `Weekly rankings start week ${String(week)}, against ${YARDSTICKS}.`,
  weeklyOrder: (day: string) => `Our weekly rankings, set ${day}`,
} as const satisfies Partial<RecordsWords>;

/** The record's words as the apps draw them: the web's table with the pending sentences as before. */
export const RECORDS_WORDS: RecordsWords = {
  ...WEB_RECORDS_WORDS,
  ...RECORDS_PENDING,
};

/** The apps' word for a played bye in a row's Bye cell; the web draws nothing there. */
export const PLAYED_BYE = "Done";

/** The apps' bye words (shared/words/bye.json): their played bye's word and the web's week form. */
export const BYE_WORDS = { done: PLAYED_BYE, week: WEB_BYE_WORDS.week } as const;

/** The apps' bye cell (BoardCells.bye): its week while ahead, "Done" once played. */
export function appByeCell(bye: number, fromWeek: number | null): string {
  const ahead = byeAhead(bye, fromWeek);
  return ahead === null ? PLAYED_BYE : String(ahead);
}

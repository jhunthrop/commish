/** The words the apps still draw where the web has moved on, so their generated words and their parity
 * stay what the apps draw until their own lane follows (Lane 223). Each entry names the web's change;
 * the app lane deletes the entry (and this file with its last one), points gen-words.ts back at the
 * web's table and regenerates.
 *
 * - The record's graded order (B188): the web names it "our rest-of-season order, graded week by
 *   week"; the apps' RecordLines still build "Our weekly rankings" by hand, so their words and the
 *   record parity keep the old sentences here. */
import {
  RECORDS_WORDS as WEB_RECORDS_WORDS,
  type RecordsWords,
} from "../../web/src/lib/run/records.ts";

const YARDSTICKS = "ESPN and the week's published projection";

/** The record's words as the apps draw them: the web's table with its Lane 223 sentences as before. */
export const RECORDS_WORDS: RecordsWords = {
  ...WEB_RECORDS_WORDS,
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
};

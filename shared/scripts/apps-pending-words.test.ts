// The apps' pending words (Lane 223 review L2): every entry still differs from the web's, so an entry
// the web has caught up with (or a web word reverted to the apps') fails here and is deleted, never kept
// silently. Run with `node --test shared/scripts/*.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { byeCell } from "../../web/src/lib/format/bye.ts";
import { RECORDS_WORDS as WEB_RECORDS_WORDS } from "../../web/src/lib/run/records.ts";
import { RECORDS_PENDING, appByeCell } from "./apps-pending-words.ts";

/** A sample call for each pending function, so two functions are compared by what they say. */
const SAMPLES: Readonly<Record<string, readonly (string | number)[]>> = {
  before: [7],
  frontWeekly: ["week 7", "188 players"],
  frontWeeklyNext: [7],
  weeklyOrder: ["Oct 22"],
};

function said(value: unknown, key: string): string {
  if (typeof value === "string") return value;
  const sample = SAMPLES[key];
  if (typeof value !== "function" || sample === undefined)
    throw new Error(`No sample to compare the pending ${key} by.`);
  return String((value as (...args: (string | number)[]) => unknown)(...sample));
}

void test("every pending record sentence still differs from the web's", () => {
  for (const [key, pending] of Object.entries(RECORDS_PENDING)) {
    const web = WEB_RECORDS_WORDS[key as keyof typeof RECORDS_PENDING];
    assert.notEqual(
      said(pending, key),
      said(web, key),
      `${key} says what the web says: delete it from apps-pending-words.ts`,
    );
  }
});

void test("the apps' played bye still differs from the web's cell", () => {
  assert.notEqual(appByeCell(5, 7), byeCell(5, 7));
  assert.equal(appByeCell(11, 7), byeCell(11, 7));
});

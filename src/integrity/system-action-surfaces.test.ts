import { describe, expect, it } from "vitest";
import { NOTICE_TEMPLATES, type NoticeType } from "./notices";
import { SYSTEM_ACTION_CODES, SYSTEM_ACTION_VISIBILITY, type SystemActionCode } from "./system-actions";

/**
 * The parent's Task 14 Step 4 (its own inert-deliverable sweep) proves every `SYSTEM_ACTION_CODES`
 * entry has a PUBLISHER. This proves every one has a READER: an `activityRowFor` branch reaching a
 * member-facing surface, a notice template that reaches the member directly, or an explicit
 * "nothing to show" visibility with its reason stated where a reviewer can read it.
 *
 * `readerFor` mirrors — deliberately, not by importing — the two real dispatch points that decide
 * whether a code reaches anybody: `NOTICE_TEMPLATES` (`./notices`), the member's own inbox, and
 * `SYSTEM_ACTION_VISIBILITY` (`./system-actions`), which gates `renderSystemAction`'s generic
 * summary-field render in `activity-view.ts`. A code can be BOTH (`stat_week_corrected` reaches the
 * activity feed and the member's inbox), reachable through exactly one (`house_league_opened` has
 * no notice — a league with no members yet has nobody to notify — but is `"everyone"`-visible on
 * its own league chain once members arrive), or `"hidden"` from the feed while still reaching the
 * one person it is about through a notice (`trade_held_for_review`, `tier_blocked_join` — hidden
 * from the room, not from the member it concerns). A second mirror, not a shared implementation:
 * the production dispatch and this test can drift, and drifting is exactly the failure this file
 * exists to catch.
 */

/**
 * The one code with neither a notice nor `"everyone"`/`"subject_only"` activity visibility —
 * `chain_verification_failed`, per `SYSTEM_ACTION_VISIBILITY`'s own docblock: telling a league its
 * record may have been altered, before a human has read the output, is the accusation Plan A
 * ruling 8 spends a denylist preventing. Every other truly `"hidden"` code (`trade_held_for_review`,
 * `tier_blocked_join`) still reaches its subject through a notice, so it is not listed here — this
 * map is for a code with NO reader at all, and each entry states why that is correct on purpose.
 */
const HIDDEN_WITH_NO_READER: Readonly<Partial<Record<SystemActionCode, string>>> = {
  chain_verification_failed: "An unread accusation, on purpose (Plan A ruling 8) — telling a league its record may have been altered before a human reviews the output.",
};

function readerFor(code: SystemActionCode): string | null {
  if (code in NOTICE_TEMPLATES) return `notice:${code}`;
  const visibility = SYSTEM_ACTION_VISIBILITY[code];
  if (visibility === "everyone") return `activity:${code}`;
  return HIDDEN_WITH_NO_READER[code] ?? null;
}

describe("every system action code has a reader, not just a writer", () => {
  it("gives every system action a reader, not just a writer", () => {
    for (const code of SYSTEM_ACTION_CODES) {
      expect(readerFor(code), `System action "${code}" is written and never read.`).not.toBeNull();
    }
  });

  it("names the one code with no reader and states why that is correct", () => {
    // The reverse guard: a code silently added to HIDDEN_WITH_NO_READER without a real reason
    // would make the test above pass for the wrong cause. Each entry's string must say something.
    for (const [code, reason] of Object.entries(HIDDEN_WITH_NO_READER)) {
      expect(reason.length, `"${code}"'s HIDDEN_WITH_NO_READER entry has no stated reason.`).toBeGreaterThan(0);
      expect(SYSTEM_ACTION_VISIBILITY[code as SystemActionCode]).toBe("hidden");
    }
  });

  it("never lists a code as unread while a notice template already reaches it", () => {
    const noticeTypes = new Set<string>(Object.keys(NOTICE_TEMPLATES) as NoticeType[]);
    for (const code of Object.keys(HIDDEN_WITH_NO_READER)) {
      expect(noticeTypes.has(code), `"${code}" is listed as having no reader, but a notice template already reaches it.`).toBe(false);
    }
  });
});

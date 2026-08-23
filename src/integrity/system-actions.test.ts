import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "@/domain/audit";
import { activityRowFor } from "./activity-view";
import { sourceFilesIn } from "./test-support";
import { SYSTEM_ACTION_CODES, SYSTEM_ACTION_VISIBILITY, systemActionSummaryAllowed, type SystemActionCode } from "./system-actions";

describe("SYSTEM_ACTION_VISIBILITY", () => {
  it("decides every system action code in the vocabulary, deny by default", () => {
    expect(Object.keys(SYSTEM_ACTION_VISIBILITY).sort()).toEqual([...SYSTEM_ACTION_CODES].sort());
  });

  it("allows two codes to everyone: stat_week_corrected and draft_auto_started, both facts about nobody's conduct", () => {
    expect(SYSTEM_ACTION_VISIBILITY.stat_week_corrected).toBe("everyone");
    expect(SYSTEM_ACTION_VISIBILITY.draft_auto_started).toBe("everyone");
  });

  it("scopes lineup_auto_set to its subject alone, the actor-scoped path Plan B pre-decided, corrected to subject", () => {
    expect(SYSTEM_ACTION_VISIBILITY.lineup_auto_set).toBe("subject_only");
  });

  it("hides chain_verification_failed, restating ruling 8 rather than leaving it to the renderer alone", () => {
    expect(SYSTEM_ACTION_VISIBILITY.chain_verification_failed).toBe("hidden");
  });

  it("hides trade_held_for_review and tier_blocked_join — both platform-chain, never read by a league feed at all", () => {
    expect(SYSTEM_ACTION_VISIBILITY.trade_held_for_review).toBe("hidden");
    expect(SYSTEM_ACTION_VISIBILITY.tier_blocked_join).toBe("hidden");
  });

  it("is a real Record over the whole union, so a code added later without an entry does not compile", () => {
    // Compile-time proof, made visible in the suite: every SystemActionCode indexes into the
    // table without a cast. The runtime assertion above is what actually fails if a value ever
    // reads back `undefined` for a key TypeScript believes is present.
    const values: readonly string[] = SYSTEM_ACTION_CODES.map((code: SystemActionCode) => SYSTEM_ACTION_VISIBILITY[code]);
    expect(values.every((value) => value === "everyone" || value === "subject_only" || value === "hidden")).toBe(true);
  });
});

// -----------------------------------------------------------------------------------------
// FINAL REVIEW F7 — the class test.
//
// `draft_auto_started` was granted `"everyone"` and its sole publisher wrote no `summary`, so
// `renderSystemAction` answered `null` for every viewer, always: the event was written, read and
// discarded. Nothing failed and no test caught it, because the intent was delivered by a
// per-team notice instead. That is the declared-and-unimplemented anti-pattern this phase bans,
// and `reserved.test.ts` had already closed the equivalent hole for `AUDIT_EVENT_TYPES` while
// explicitly handing this vocabulary's growth path forward with no equivalent guard behind it.
//
// The property, stated once: EVERY code this table grants a visibility to (anything but
// `"hidden"`) has a real publisher in production source, and the event that publisher emits
// RENDERS NON-NULL for that code's own sanctioned audience.
// -----------------------------------------------------------------------------------------

/** Every production `.ts` under `src` and `scripts` — `sourceFilesIn` excludes `*.test.*` and
 *  every `test-*` support file, so a code "published" only by a fixture is not published, the
 *  identical discipline `reserved.test.ts`'s own scan keeps. Two directories because a real
 *  publisher can be a CLI entry point (`scripts/verify-audit-chain.ts` writes one of these). */
const PRODUCTION_SOURCE = sourceFilesIn(["src", "scripts"], ".ts").map((path) => ({ path, text: readFileSync(path, "utf8") }));

/**
 * Every `payload: { … }` object literal in `text`, as raw source. Brace-MATCHED rather than
 * regex-terminated: a summary composed with a template literal carries its own `}` from a
 * `${…}` interpolation, and a lazy `[^}]*` would truncate the literal right before the field
 * this test exists to look for.
 */
function payloadLiterals(text: string): readonly string[] {
  const literals: string[] = [];
  const marker = "payload: {";
  for (let start = text.indexOf(marker); start !== -1; start = text.indexOf(marker, start + 1)) {
    let depth = 0;
    for (let index = start + marker.length - 1; index < text.length; index += 1) {
      if (text[index] === "{") depth += 1;
      else if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          literals.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return literals;
}

/**
 * The payload literals that publish `code`, across all production source.
 *
 * A publisher may name the code inline (`action: "draft_auto_started"`) or through a module-local
 * alias (`const ACTION: SystemActionCode = "stat_week_corrected"`, which is what
 * `@/stats-pipeline/correction` does). Both are resolved, per file, so this test measures the
 * publishers production actually has rather than the subset that happens to inline a literal —
 * the same "measure the real builder, never a lookalike" lesson F9 taught the EXPLAIN suite.
 */
function publishersOf(code: SystemActionCode): readonly { readonly path: string; readonly literal: string }[] {
  return PRODUCTION_SOURCE.flatMap((file) => {
    const aliases = [...file.text.matchAll(/const\s+(\w+)\s*:\s*SystemActionCode\s*=\s*"([\w]+)"/g)]
      .filter(([, , aliased]) => aliased === code)
      .map(([, name]) => name!);
    const names = [`action: "${code}"`, ...aliases.map((name) => `action: ${name},`)];
    return payloadLiterals(file.text)
      .filter((literal) => names.some((name) => literal.includes(name)))
      .map((literal) => ({ path: file.path, literal }));
  });
}

/** The visibility-granted codes: everything this table does not hide. */
const GRANTED = SYSTEM_ACTION_CODES.filter((code) => SYSTEM_ACTION_VISIBILITY[code] !== "hidden");

function systemActionEvent(payload: Record<string, unknown>): AuditEvent {
  return {
    eventId: "evt_class",
    chainScope: "league_1",
    sequence: 1,
    eventType: "system_action",
    actorId: null,
    actorType: "system",
    leagueId: "league_1",
    payload: payload as AuditEvent["payload"],
    occurredAt: "2026-08-22T17:00:00.000Z",
    previousEventHash: "genesis",
    eventHash: "hash1",
    hashVersion: 1,
  };
}

const NAMES = { member: () => "A member", player: () => "A player", team: () => "A team" };

describe("every visibility-granted system action has a renderable publisher (final review F7)", () => {
  it("scans real production source, and the scan is not vacuous", () => {
    expect(PRODUCTION_SOURCE.length).toBeGreaterThan(0);
    for (const file of PRODUCTION_SOURCE) expect(file.path).not.toMatch(/\.test\.|[/\\]test-/);
    expect(GRANTED.length).toBeGreaterThan(0);
  });

  it.each(GRANTED)("%s has at least one production publisher", (code) => {
    expect(publishersOf(code).length).toBeGreaterThan(0);
  });

  it.each(GRANTED)("%s's publisher writes the summary its renderer requires", (code) => {
    // `renderSystemAction` (`@/integrity/activity-view`) returns `null` when `summary` is absent,
    // so a publisher that omits it ships a code nobody can ever see.
    for (const publisher of publishersOf(code)) {
      expect(publisher.literal, `${publisher.path} publishes ${code} with no summary`).toContain("summary:");
    }
  });

  it.each(GRANTED.filter((code) => SYSTEM_ACTION_VISIBILITY[code] === "subject_only"))(
    "%s's publisher writes the subjectUserId its renderer scopes on",
    (code) => {
      // The other half of the same contract: a `subject_only` code with no `subjectUserId` denies
      // for everyone, exactly the way a missing summary does.
      for (const publisher of publishersOf(code)) {
        expect(publisher.literal, `${publisher.path} publishes ${code} with no subjectUserId`).toContain("subjectUserId:");
      }
    },
  );

  it.each(GRANTED)("%s renders a real headline for its sanctioned audience", (code) => {
    const subjectUserId = "u_subject";
    const row = activityRowFor(
      systemActionEvent({ action: code, summary: "A sentence a member reads.", subjectUserId }),
      { userId: SYSTEM_ACTION_VISIBILITY[code] === "subject_only" ? subjectUserId : "u_anyone" },
      NAMES,
    );
    expect(row).not.toBeNull();
    expect(row!.headline).toBe("A sentence a member reads.");
  });

  it("still denies a hidden code, whatever its payload carries", () => {
    for (const code of SYSTEM_ACTION_CODES.filter((c) => SYSTEM_ACTION_VISIBILITY[c] === "hidden")) {
      const row = activityRowFor(
        systemActionEvent({ action: code, summary: "Should never be seen.", subjectUserId: "u_anyone" }),
        { userId: "u_anyone" },
        NAMES,
      );
      expect(row).toBeNull();
    }
  });
});

describe("systemActionSummaryAllowed", () => {
  it("keeps every previously-decided code exactly where Plan B left it — a zero-line diff for the three existing consumers", () => {
    expect(systemActionSummaryAllowed("stat_week_corrected")).toBe(true);
    expect(systemActionSummaryAllowed("chain_verification_failed")).toBe(false);
    expect(systemActionSummaryAllowed("trade_held_for_review")).toBe(false);
  });

  it("is true only for a code SYSTEM_ACTION_VISIBILITY marks everyone, never for subject_only or hidden", () => {
    for (const code of SYSTEM_ACTION_CODES) {
      expect(systemActionSummaryAllowed(code)).toBe(SYSTEM_ACTION_VISIBILITY[code] === "everyone");
    }
    expect(systemActionSummaryAllowed("lineup_auto_set")).toBe(false);
    expect(systemActionSummaryAllowed("tier_blocked_join")).toBe(false);
  });

  it("allows draft_auto_started — its visibility decision, held by its Task 7 publisher unchanged", () => {
    expect(systemActionSummaryAllowed("draft_auto_started")).toBe(true);
  });
});

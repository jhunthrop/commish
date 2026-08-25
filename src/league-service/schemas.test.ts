import { describe, expect, it, vi } from "vitest";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { acceptInviteSchema, createLeagueSchema, FREE_SEASON_ENTRY_FEE_MESSAGE } from "./schemas";

/**
 * Phase 4, Task 8: the boundary's money rules need BOTH sides of the dark/live switch — the
 * shipped `MONEY_STATES.enabled` is empty, so without this seam the "a valid paid league parses
 * once money is live" branch could never run. Only `moneyIsLive` is replaced; everything else in
 * the module stays real.
 */
const liveness = { live: false };
vi.mock("@/money/states", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/money/states")>();
  return { ...actual, moneyIsLive: () => liveness.live };
});

/** Built from code points so this file, too, contains no invisible characters. */
const ch = (code: number): string => String.fromCharCode(code);

/**
 * HIGH-2. A league name is not just rendered — it is INTERPOLATED into a sentence the platform
 * writes in its own voice ("The clock ran out on pick 24 in <league>"), and ruling 12 stores that
 * sentence verbatim and never re-renders it. So a bidi override in a league name is not a
 * transient rendering problem the way it is on a page that re-renders from source every time: it
 * is frozen into `member_notices.body` for the life of the row, in the inbox of every member the
 * autopick affected, and repairing those rows is exactly what ruling 12 forbids.
 *
 * The repo already owned the defence (`isPrintableDisplayName`) and had it wired to one boundary,
 * the profile PATCH. These are the other two doors.
 */
describe("league and team names are held to the same printable rule as a display name", () => {
  it("refuses a league name carrying a right-to-left override", () => {
    const result = createLeagueSchema.safeParse({ name: `${ch(0x202e)}Sunday Money` });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Please use only characters people can see.");
  });

  it("refuses a team name carrying a zero-width joiner, on both doors that take one", () => {
    expect(createLeagueSchema.safeParse({ name: "Sunday Money", teamName: `Ada${ch(0x200d)}s Team` }).success).toBe(false);
    expect(acceptInviteSchema.safeParse({ teamName: `Ada${ch(0x200d)}s Team` }).success).toBe(false);
  });

  it("refuses control characters, including the newline that would split a stored sentence", () => {
    expect(createLeagueSchema.safeParse({ name: `Sunday${ch(0x0a)}Money` }).success).toBe(false);
    expect(createLeagueSchema.safeParse({ name: `Sunday${ch(0x00)}Money` }).success).toBe(false);
  });

  it("still accepts an ordinary name in any script, defaults and all", () => {
    const result = createLeagueSchema.safeParse({ name: "リーグ Money" });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBe("リーグ Money");
    expect(createLeagueSchema.safeParse({ name: "Sunday Money", teamName: "Renée's Raiders" }).success).toBe(true);
  });
});

// Phase 3.5, Task 7: the sit-and-go trigger is public-matchmade only.
describe("startTrigger", () => {
  it("defaults to 'scheduled', so an ordinary create request is unaffected", () => {
    const result = createLeagueSchema.safeParse({ name: "Sunday Money" });
    expect(result.success).toBe(true);
    expect(result.data?.startTrigger).toBe("scheduled");
  });

  it("refuses 'when_full' on an invite-only league, naming the field that has to change", () => {
    const result = createLeagueSchema.safeParse({ name: "Sunday Money", startTrigger: "when_full", visibility: "invite_only" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ["startTrigger"],
      message: "Leagues that start when they fill are public leagues. Make this one public, or pick a draft time.",
    });
  });

  it("accepts 'when_full' once the league is also made public", () => {
    const result = createLeagueSchema.safeParse({ name: "Sunday Money", startTrigger: "when_full", visibility: "public" });
    expect(result.success).toBe(true);
  });

  it("never refuses 'scheduled' regardless of visibility", () => {
    expect(createLeagueSchema.safeParse({ name: "Sunday Money", startTrigger: "scheduled", visibility: "invite_only" }).success).toBe(true);
    expect(createLeagueSchema.safeParse({ name: "Sunday Money", startTrigger: "scheduled", visibility: "public" }).success).toBe(true);
  });
});

// Phase 4, Task 8: entry fees at the creation boundary.
describe("entry fee, platform fee and payout table", () => {
  const teamCount = 4;
  const paid = (over: Record<string, unknown> = {}) => ({
    name: "Sunday Money",
    teamCount,
    entryFeeCents: 20_00,
    payoutTable: [{ place: 1, amountCents: 80_00 }],
    ...over,
  });

  it("defaults every money field to the free league, so an ordinary create request is unaffected", () => {
    const result = createLeagueSchema.safeParse({ name: "Sunday Money" });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ entryFeeCents: 0, platformFeeCents: 0 });
    expect(result.data?.payoutTable).toBeUndefined();
  });

  it("refuses a negative fee and a fee above the founder's ceiling, ceiling rendered from config", () => {
    expect(createLeagueSchema.safeParse(paid({ entryFeeCents: -1 })).success).toBe(false);
    const over = createLeagueSchema.safeParse(paid({ entryFeeCents: MONEY_CONFIG.entryFeeCeilingCents + 1 }));
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]?.message).toBe("An entry fee can be at most $500.00 per seat.");
    expect(createLeagueSchema.safeParse(paid({ platformFeeCents: -1 })).success).toBe(false);
  });

  it("refuses a paid league while money is dark, with the free-season sentence on the fee field", () => {
    liveness.live = false;
    const result = createLeagueSchema.safeParse(paid());
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ path: ["entryFeeCents"], message: FREE_SEASON_ENTRY_FEE_MESSAGE });
  });

  it("holds any money field to the one arithmetic law, dark or live — the same leagueMoneyOrRefuse the service enforces", () => {
    liveness.live = false;
    const mismatch = createLeagueSchema.safeParse(paid({ payoutTable: [{ place: 1, amountCents: 79_00 }] }));
    expect(mismatch.success).toBe(false);
    expect(mismatch.error?.issues[0]).toMatchObject({ path: ["payoutTable"], message: MONEY_REFUSALS.prizeTableMismatch });

    expect(createLeagueSchema.safeParse(paid({ payoutTable: undefined })).success).toBe(false);
    expect(createLeagueSchema.safeParse({ name: "Sunday Money", teamCount, platformFeeCents: 1_00 }).success).toBe(false);
    const badPlace = createLeagueSchema.safeParse(paid({ payoutTable: [{ place: 2, amountCents: 80_00 }] }));
    expect(badPlace.success).toBe(false);
    expect(badPlace.error?.issues[0]?.message).toBe(MONEY_REFUSALS.invalidPrizeTableEntry);
  });

  it("accepts a balanced paid league once money is live", () => {
    liveness.live = true;
    try {
      const result = createLeagueSchema.safeParse(paid({ platformFeeCents: 1_00, payoutTable: [{ place: 1, amountCents: 76_00 }] }));
      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ entryFeeCents: 20_00, platformFeeCents: 1_00 });
    } finally {
      liveness.live = false;
    }
  });
});

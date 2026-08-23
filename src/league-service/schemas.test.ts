import { describe, expect, it } from "vitest";
import { acceptInviteSchema, createLeagueSchema } from "./schemas";

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

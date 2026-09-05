import { describe, it, expect, beforeEach, vi } from "vitest";

// Route-level: every read `loadRoomData` makes is mocked, the same discipline
// `trades/page.test.tsx` already holds for a full-room read — this test is about Task 10's OWN
// wiring (the `draftGradesVisible`/`draftId` gate deciding whether `gradesForDraft` is even
// called), not about re-proving any of these sibling reads.
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/identity-service/preferences", () => ({ readPreferences: vi.fn() }));
vi.mock("@/integrity-service/activity", () => ({ listLeagueActivity: vi.fn() }));
vi.mock("@/integrity-service/notify", () => ({ listNotices: vi.fn(), quoteFor: vi.fn() }));
vi.mock("@/league-service", () => ({
  leagueHome: vi.fn(),
  lineupView: vi.fn(),
  matchupWeek: vi.fn(),
  weeklyProjectionsByPlayerId: vi.fn(),
  fixtureLabelsByTeam: vi.fn(),
  gradesForDraft: vi.fn(),
}));
vi.mock("@/league-service/nfl-schedule", () => ({ byeWeeksByTeam: vi.fn() }));
vi.mock("@/league-service/claims", () => ({ pendingWaiverClaims: vi.fn() }));
vi.mock("@/league-service/trades", () => ({ listTrades: vi.fn() }));
vi.mock("@/league-service/reference-cache-instance", () => ({ getReferenceCache: () => ({}) }));

import { readPreferences } from "@/identity-service/preferences";
import { listLeagueActivity } from "@/integrity-service/activity";
import { leagueHome, lineupView, matchupWeek, weeklyProjectionsByPlayerId, fixtureLabelsByTeam, gradesForDraft } from "@/league-service";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import { pendingWaiverClaims } from "@/league-service/claims";
import { listTrades } from "@/league-service/trades";
import type { CurrentUser } from "@/lib/auth/current-user";
import { HOME } from "@/league-room/test-fixtures";
import { loadRoomData } from "./room-data";

const USER: CurrentUser = {
  id: "u1", email: "u1@test.local", displayName: "Ada Lovelace",
  experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false,
};

const STORED_GRADES = [
  { teamId: "t1", teamName: "Bay Bandits", letter: "B" as const, projectedRank: 2, components: { valueCaptured: -6.5, startingSlotsFilled: 8, startingSlotsTotal: 9, byeCollisions: 1, projectedPoints: 118.4 } },
];

beforeEach(() => {
  vi.mocked(readPreferences).mockResolvedValue({ helpLevel: "standard", draftTourDismissedAt: null });
  vi.mocked(listLeagueActivity).mockResolvedValue({ rows: [], nextBefore: null });
  vi.mocked(lineupView).mockResolvedValue(null);
  vi.mocked(matchupWeek).mockResolvedValue(null);
  vi.mocked(weeklyProjectionsByPlayerId).mockResolvedValue(new Map());
  vi.mocked(fixtureLabelsByTeam).mockResolvedValue(new Map());
  vi.mocked(byeWeeksByTeam).mockResolvedValue(new Map());
  vi.mocked(pendingWaiverClaims).mockResolvedValue([]);
  vi.mocked(listTrades).mockResolvedValue({ leagueId: "l1", meTeamId: "t1", inbox: [], outbox: [], history: [] });
  vi.mocked(gradesForDraft).mockResolvedValue({ grades: STORED_GRADES, boardGeneration: "2026-08-01T00:00:00.000Z" });
  vi.mocked(gradesForDraft).mockClear();
  vi.mocked(leagueHome).mockReset();
});

describe("loadRoomData — Task 10's grades gate", () => {
  it("loads and formats the stored grades when the league is drafted and opted in", async () => {
    vi.mocked(leagueHome).mockResolvedValue({ ...HOME, draftGradesVisible: true, draftId: "d1", draftStatus: "complete" });
    const data = await loadRoomData(USER, "l1");
    expect(gradesForDraft).toHaveBeenCalledWith(expect.anything(), "d1");
    expect(data!.grades).toEqual(STORED_GRADES);
    expect(data!.gradesBasis).toBe("August 1");
  });

  it("never calls gradesForDraft, and carries no grades, once the commissioner has opted out", async () => {
    vi.mocked(leagueHome).mockResolvedValue({ ...HOME, draftGradesVisible: false, draftId: "d1", draftStatus: "complete" });
    const data = await loadRoomData(USER, "l1");
    expect(gradesForDraft).not.toHaveBeenCalled();
    expect(data!.grades).toEqual([]);
    expect(data!.gradesBasis).toBe("");
  });

  it("never calls gradesForDraft before the draft is complete — there is nothing to grade yet", async () => {
    vi.mocked(leagueHome).mockResolvedValue({ ...HOME, draftGradesVisible: true, draftId: "d1", draftStatus: "scheduled" });
    const data = await loadRoomData(USER, "l1");
    expect(gradesForDraft).not.toHaveBeenCalled();
    expect(data!.grades).toEqual([]);
    expect(data!.gradesBasis).toBe("");
  });
});

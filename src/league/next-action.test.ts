import { describe, it, expect } from "vitest";
import { nextAction, type NextActionInput } from "./next-action";

/** A full team, mid-season, week scheduled, nothing pending — the "no action" baseline every
 *  test below overrides exactly one field of. */
const BASE: NextActionInput = {
  isCommissioner: false,
  filledTeams: 10,
  teamCount: 10,
  myTeamId: "t1",
  draftStatus: "complete",
  weekStatus: null,
};

describe("nextAction", () => {
  it("returns join-draft when the draft is live and I have a seat", () => {
    expect(nextAction({ ...BASE, draftStatus: "in_progress", myTeamId: "t1" })).toEqual({
      kind: "join-draft",
      label: "Join the draft",
    });
  });

  it("does not offer join-draft when the draft is live but I have no team", () => {
    expect(nextAction({ ...BASE, draftStatus: "in_progress", myTeamId: null, filledTeams: 10, teamCount: 10 })).toEqual(null);
  });

  it("returns invite-managers when I am the commissioner and seats are empty", () => {
    expect(nextAction({ ...BASE, isCommissioner: true, filledTeams: 6, teamCount: 10 })).toEqual({
      kind: "invite-managers",
      label: "Invite managers",
    });
  });

  it("does not offer invite-managers to a non-commissioner, even with empty seats", () => {
    expect(nextAction({ ...BASE, isCommissioner: false, filledTeams: 6, teamCount: 10 })).toEqual(null);
  });

  it("does not offer invite-managers to the commissioner once every seat is filled", () => {
    expect(nextAction({ ...BASE, isCommissioner: true, filledTeams: 10, teamCount: 10 })).toEqual(null);
  });

  it("returns open-draft-room when the draft is scheduled, not started", () => {
    expect(nextAction({ ...BASE, draftStatus: "scheduled" })).toEqual({
      kind: "open-draft-room",
      label: "Open the draft room",
    });
  });

  it("returns set-lineup when the week is scheduled and I have a team", () => {
    expect(nextAction({ ...BASE, myTeamId: "t1", weekStatus: "scheduled" })).toEqual({
      kind: "set-lineup",
      label: "Set your lineup",
    });
  });

  it("does not offer set-lineup for a scheduled week when I have no team", () => {
    expect(nextAction({ ...BASE, myTeamId: null, weekStatus: "scheduled" })).toEqual(null);
  });

  it("returns watch-scores when the week is in progress", () => {
    expect(nextAction({ ...BASE, weekStatus: "in_progress" })).toEqual({
      kind: "watch-scores",
      label: "Watch the scores",
    });
  });

  it("offers watch-scores even without a team of my own", () => {
    expect(nextAction({ ...BASE, myTeamId: null, weekStatus: "in_progress" })).toEqual({
      kind: "watch-scores",
      label: "Watch the scores",
    });
  });

  it("returns review-week when the week is final", () => {
    expect(nextAction({ ...BASE, weekStatus: "final" })).toEqual({
      kind: "review-week",
      label: "See how the week went",
    });
  });

  it("returns null when nothing is pending: drafted, full, and no current week", () => {
    expect(nextAction(BASE)).toEqual(null);
  });

  it("treats a league with no draft row (draftStatus null) like a completed draft: falls through to the week's own state", () => {
    // `crossLeagueHome` can legitimately pass `null` here — a league whose draft row doesn't
    // exist. Neither `draftStatus === "in_progress"` nor `=== "scheduled"` matches `null`, so
    // this must fall straight through to the week-state checks, exactly as "complete" does.
    expect(nextAction({ ...BASE, draftStatus: null, weekStatus: "scheduled" })).toEqual({
      kind: "set-lineup",
      label: "Set your lineup",
    });
    expect(nextAction({ ...BASE, draftStatus: null, weekStatus: "in_progress" })).toEqual({
      kind: "watch-scores",
      label: "Watch the scores",
    });
    expect(nextAction({ ...BASE, draftStatus: null })).toEqual(null);
  });

  describe("precedence", () => {
    it("a live draft beats an unfilled league for its commissioner", () => {
      const input: NextActionInput = {
        isCommissioner: true,
        filledTeams: 6,
        teamCount: 10,
        myTeamId: "t1",
        draftStatus: "in_progress",
        weekStatus: null,
      };
      expect(nextAction(input)?.kind).toBe("join-draft");
    });

    it("a live draft beats the week being in progress", () => {
      const input: NextActionInput = {
        isCommissioner: false,
        filledTeams: 10,
        teamCount: 10,
        myTeamId: "t1",
        draftStatus: "in_progress",
        weekStatus: "in_progress",
      };
      expect(nextAction(input)?.kind).toBe("join-draft");
    });

    it("an unfilled league for its commissioner beats a scheduled draft's open-draft-room", () => {
      const input: NextActionInput = {
        isCommissioner: true,
        filledTeams: 6,
        teamCount: 10,
        myTeamId: "t1",
        draftStatus: "scheduled",
        weekStatus: null,
      };
      expect(nextAction(input)?.kind).toBe("invite-managers");
    });

    it("an unfilled league for its commissioner beats the week being final", () => {
      const input: NextActionInput = {
        isCommissioner: true,
        filledTeams: 6,
        teamCount: 10,
        myTeamId: "t1",
        draftStatus: "complete",
        weekStatus: "final",
      };
      expect(nextAction(input)?.kind).toBe("invite-managers");
    });

    it("a scheduled draft beats the week's own state", () => {
      const input: NextActionInput = {
        isCommissioner: false,
        filledTeams: 10,
        teamCount: 10,
        myTeamId: "t1",
        draftStatus: "scheduled",
        weekStatus: "in_progress",
      };
      expect(nextAction(input)?.kind).toBe("open-draft-room");
    });

    it("set-lineup beats watch-scores and review-week by construction: a scheduled week and an in-progress or final week are mutually exclusive states", () => {
      // Documents the invariant rather than asserting a real branch: `weekStatus` is a single
      // value, so this case cannot arise from `crossLeagueHome`'s own input. Included so the
      // precedence rule's ORDER (scheduled checked before in-progress/final) is still visible
      // beside its siblings.
      const input: NextActionInput = { ...BASE, myTeamId: "t1", weekStatus: "scheduled" };
      expect(nextAction(input)?.kind).toBe("set-lineup");
    });
  });
});

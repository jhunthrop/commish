import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PlayerDossierFacts } from "@/league-service/dossier-facts";
import type { PlayerOwner, PlayerSeasonBody } from "@/league-service/player";
import { heroNumberFor, PlayerHeader, verbFor } from "./player-header";

/**
 * THE HEADER BOTH SURFACES SHARE. Every claim here is a principle with a test beside it: one big
 * number that names its basis (P2, P11), the person who holds him before that number (P1), the ring
 * that says what that person is to the reader (P6), and exactly one solid verb (P3).
 */

const BODY: PlayerSeasonBody = {
  player: { id: "rb1", name: "James Cook", position: "RB", nflTeam: "BUF", headshotUrl: null, adp: 22.4 },
  availableSeasons: [2026],
  season: 2026,
  isRookie: false,
  positionRank: 8,
  adpPercentile: 0.9,
  expertRank: 19,
  modelRank: 21,
  pointsPerGame: 20.2,
  pointsPerGamePercentile: 0.8,
  weeks: [{ week: 1, points: 13.3, percentile: 0.6 }],
  ownedBy: null,
  isMockLeague: false,
  injuryDesignation: null,
  log: [],
  totals: null,
  kdefSeason: null,
  news: [],
  reasons: [],
  laws: [],
};

const OWNER: PlayerOwner = { teamId: "t2", teamName: "Iron Owls", managerName: "Rey Okafor", managerAvatar: null, relation: "other" };

/** Only the two fields the header reads off a dossier — the rest of `PlayerDossierFacts` belongs to
 *  the modules under it and is never touched here. */
function withProjection(projectedPoints: number, scoringLabel: string): PlayerSeasonBody {
  const dossier = { projection: { projectedPoints }, basis: { scoringLabel }, byeWeek: 7 } as unknown as PlayerDossierFacts;
  return { ...BODY, dossier };
}

describe("the one big number and its basis", () => {
  it("leads with the season projection and names the format it was computed under", () => {
    expect(heroNumberFor(withProjection(241.4, "PPR"))).toEqual({ value: "241", basis: "Projected for the season, PPR, 2026" });
  });

  /** THE BOTH-BASES LAW. A rate under this LEAGUE's rules and a projection under the BOARD's are
   *  different claims, and neither may borrow the other's caption. */
  it("falls back to his rate under this league's own scoring, and says whose scoring that is", () => {
    expect(heroNumberFor(BODY)).toEqual({ value: "20.2", basis: "A game, 2026, under this league's scoring" });
  });

  it("holds a dash and says why when there is neither, and never a zero", () => {
    expect(heroNumberFor({ ...BODY, pointsPerGame: null })).toEqual({ value: null, basis: "Nothing scored for him in 2026 yet" });
  });
});

/**
 * THE VERB FOLLOWS THE LEAGUE'S DRAFT (fix rounds 1's M2 and 2's H1). It read only `isMockLeague`
 * at first, so a pre-draft manager was offered an add he cannot make; then only "has it drafted",
 * which folded a RUNNING draft in with a scheduled one. The peek is mounted inside the draft room,
 * so that second version put a solid pill linking OUT of a draft into the middle of a live one.
 * Three phases, and the surface matters in exactly one of them.
 */
const DRAFTED = { ...BODY, draftPhase: "complete" as const };
const LIVE = { ...BODY, draftPhase: "live" as const };

describe("the one verb", () => {
  it("offers a trade to the manager who has him, by his own first name", () => {
    expect(verbFor({ ...DRAFTED, owner: OWNER }, "lg1", "full")).toEqual({ label: "Offer Rey a trade", href: "/app/leagues/lg1/trades" });
  });

  /** HELD BY YOU IS NOT A VERB. There is nothing to do about a player you already have from HIS
   *  page, and a solid pill that merely navigates away is the second call to action P3 rules out.
   *  The header states the fact quietly instead (`Your player`, asserted on the render below). */
  it("offers nothing solid when he is already yours", () => {
    expect(verbFor({ ...DRAFTED, owner: { ...OWNER, relation: "you" } }, "lg1", "full")).toBeNull();
  });

  it("offers to add a free agent once the league has drafted", () => {
    expect(verbFor(DRAFTED, "lg1", "full")).toEqual({ label: "Add him", href: "/app/leagues/lg1/players" });
  });

  it("sends a pre-draft manager to the board with him in view, never an add he cannot make", () => {
    expect(verbFor(BODY, "lg1", "full")).toEqual({ label: "Open the board", href: "/app/draft/board?league=lg1&q=James+Cook" });
    expect(verbFor(BODY, "lg1", "peek")).toEqual({ label: "Open the board", href: "/app/draft/board?league=lg1&q=James+Cook" });
  });

  /**
   * THE PEEK NEVER CARRIES A NAVIGATION VERB WHILE A DRAFT IS LIVE (fix round 2, H1). The room has
   * its own Draft verb and the peek is raised INSIDE it (`draft-room.tsx`), so a pill that leaves
   * the room is a way out of a thing the manager is in the middle of. The full page is not inside
   * the room and keeps the board link.
   */
  it("carries no verb in the peek while the draft is live, and keeps the board link on the page", () => {
    expect(verbFor(LIVE, "lg1", "peek")).toBeNull();
    expect(verbFor(LIVE, "lg1", "full")).toEqual({ label: "Open the board", href: "/app/draft/board?league=lg1&q=James+Cook" });
  });

  /** An absent `hasDrafted` is a body nobody told, and "we were not told" is answered the same way
   *  as "not yet": the board, never an add we cannot stand behind. */
  it("treats a body that was never told as pre-draft", () => {
    expect(verbFor({ ...BODY, owner: null }, "lg1", "full")?.label).toBe("Open the board");
  });

  /** A mock room's roster fact is a seeded bot's, so every verb it would offer is about a room that
   *  does not exist the way a real league does. */
  it("offers nothing at all in a practice room", () => {
    expect(verbFor({ ...DRAFTED, isMockLeague: true }, "lg1", "full")).toBeNull();
    expect(verbFor({ ...DRAFTED, isMockLeague: true }, "lg1", "peek")).toBeNull();
  });
});

describe("PlayerHeader", () => {
  it("puts the person who has him before the number, with no ring for another manager, in both themes", async () => {
    await renderSurface(<PlayerHeader body={{ ...BODY, owner: OWNER }} leagueId="lg1" depth="full" />, async ({ container }) => {
      const owner = screen.getByTestId("player-owner");
      expect(owner.dataset.relation).toBe("other");
      expect(owner.textContent).toContain("Iron Owls");
      expect(owner.textContent).toContain("Rey Okafor");
      expect(owner.querySelector(".ring-2")).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("wears the amber ring when the manager holding him is you", async () => {
    await renderSurface(<PlayerHeader body={{ ...BODY, owner: { ...OWNER, relation: "you" } }} leagueId="lg1" depth="full" />, async () => {
      expect(screen.getByTestId("player-owner").querySelector(".ring-self")).not.toBeNull();
    });
  });

  /** P6: your rival is always in the frame, and the frame says so in words as well as in colour —
   *  a ring alone would be a claim carried by one channel. */
  it("wears the rose ring and says it out loud when he is on the team you play this week", async () => {
    await renderSurface(<PlayerHeader body={{ ...BODY, owner: { ...OWNER, relation: "rival" } }} leagueId="lg1" depth="full" />, async () => {
      const owner = screen.getByTestId("player-owner");
      expect(owner.querySelector(".ring-negative")).not.toBeNull();
      expect(owner.textContent).toContain("you play him this week");
    });
  });

  it("says free agency plainly when nobody has him, and draws no face for nobody", async () => {
    await renderSurface(<PlayerHeader body={BODY} leagueId="lg1" depth="full" />, async () => {
      expect(screen.getByText("Free agent in this league")).toBeInTheDocument();
      expect(screen.queryByTestId("player-owner")).not.toBeInTheDocument();
    });
  });

  /** A body assembled before this round knows the TEAM but not the person. It states the team and
   *  draws no face, rather than inventing a manager to put one beside. */
  it("states a team-only holder without a face", async () => {
    await renderSurface(<PlayerHeader body={{ ...BODY, ownedBy: "Iron Owls" }} leagueId="lg1" depth="full" />, async () => {
      expect(screen.getByText("On Iron Owls")).toBeInTheDocument();
      expect(screen.queryByTestId("player-owner")).not.toBeInTheDocument();
    });
  });

  it("carries exactly one solid verb per viewport (P3)", async () => {
    await renderSurface(<PlayerHeader body={{ ...DRAFTED, owner: OWNER }} leagueId="lg1" depth="full" />, async ({ container }) => {
      expect(container.querySelectorAll(".bg-accent")).toHaveLength(1);
      expect(screen.getByRole("link", { name: "Offer Rey a trade" })).toBeInTheDocument();
    });
  });

  it("states a player of yours as a quiet chip and draws no solid pill at all", async () => {
    await renderSurface(<PlayerHeader body={{ ...DRAFTED, owner: { ...OWNER, relation: "you" } }} leagueId="lg1" depth="full" />, async ({ container }) => {
      expect(screen.getByText("Your player")).toBeInTheDocument();
      expect(container.querySelectorAll(".bg-accent")).toHaveLength(0);
    });
  });

  /** The ruling, asserted on the rendered peek rather than on the pure function alone: a peek
   *  raised inside a live draft draws no solid Court blue pill at all. */
  it("draws zero solid pills in the peek while a draft is live", async () => {
    await renderSurface(<PlayerHeader body={{ ...LIVE, owner: OWNER }} leagueId="lg1" depth="peek" trailing={<a href="/x">Full page</a>} />, async ({ container }) => {
      expect(container.querySelectorAll(".bg-accent")).toHaveLength(0);
      expect(screen.queryByRole("link", { name: "Open the board" })).not.toBeInTheDocument();
      // The way through to the full page is still there, quiet, because it is not a verb.
      expect(screen.getByRole("link", { name: "Full page" })).toBeInTheDocument();
    });
  });

  it("is the same header at peek depth, at a face the sheet has room for", async () => {
    await renderSurface(<PlayerHeader body={withProjection(241.4, "PPR")} leagueId="lg1" depth="peek" />, async () => {
      expect(within(screen.getByTestId("big-number")).getByText("241")).toBeInTheDocument();
      expect(screen.getByText("Projected for the season, PPR, 2026")).toBeInTheDocument();
      expect(screen.getByText("Bye 7")).toBeInTheDocument();
    });
  });
});

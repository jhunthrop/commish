import { describe, expect, it } from "vitest";
import type { Player } from "@/domain/player";
import type { PlayerSeasonStats } from "@/league-service/player-season-stats";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { buildPeekDocument, hydratePeekDocument, type PeekDocumentInput, type PeekDocumentLiveFacts } from "./peek-document";
import type { PeekDocumentBasis } from "./peek-document-row";

const ASOF = new Date("2026-09-07T12:00:00.000Z");
const PRIOR = PRODUCT_SEASON - 1;

const PLAYER: Player = { id: "rb1", name: "Volume Back", position: "RB", nflTeam: "SF", headshotUrl: null, adp: 11 };

const BASIS: PeekDocumentBasis = {
  scoringHash: "hash_ppr",
  factsAsOf: "2026-09-07T04:00:00.000Z",
  capsuleGeneratedAt: null,
  capsuleFactsHash: null,
  injuryCapturedAt: null,
  newsCapturedAt: null,
  lastFinalizedWeek: 3,
  sourceKeys: ["commish_board"],
};

/** Three played weeks, worth 10, 20 and 30, with a fourth he missed. */
function stats(points: readonly (number | null)[]): PlayerSeasonStats {
  const weeks = points.map((value, index) => ({ week: index + 1, points: value, percentile: value === null ? null : 0.5 }));
  const log = weeks
    .flatMap((week) => (week.points === null ? [] : [week]))
    .map((week) => ({
      week: week.week,
      points: week.points!,
      carries: 10,
      rushingYards: week.points! * 4,
      targets: 3,
      receptions: 2,
      receivingYards: 12,
      passingYards: 0,
      touchdowns: 1,
    }))
    .sort((a, b) => b.week - a.week);
  const played = weeks.flatMap((week) => (week.points === null ? [] : [week.points]));
  return {
    weeks,
    pointsPerGame: played.length === 0 ? null : played.reduce((sum, value) => sum + value, 0) / played.length,
    pointsPerGamePercentile: 0.8,
    log,
    totals: {
      games: log.length,
      carries: 10 * log.length,
      rushingYards: log.reduce((sum, row) => sum + row.rushingYards, 0),
      targets: 3 * log.length,
      receptions: 2 * log.length,
      receivingYards: 12 * log.length,
      passingYards: 0,
      touchdowns: log.length,
      fantasyPoints: played.reduce((sum, value) => sum + value, 0),
    },
  };
}

function input(seasons: readonly number[]): PeekDocumentInput {
  return {
    player: PLAYER,
    isRookie: false,
    positionRank: 4,
    adpPercentile: 0.9,
    expertRank: 12,
    modelRank: 9,
    injuryDesignation: "Q",
    news: [{ title: "Back at practice", link: "https://example.test/one" }],
    reasons: [],
    capsule: null,
    dossier: null,
    seasons: seasons.map((season) => ({ season, stats: stats([10, 20, 30, null]) })),
    asOf: ASOF,
    basis: BASIS,
  };
}

const LIVE: PeekDocumentLiveFacts = { ownedBy: "Team One", isMockLeague: false, seasonWeeks: 14, requestedSeason: undefined };

describe("buildPeekDocument", () => {
  it("carries every available season, so a switch in the peek needs no fetch", () => {
    const document = buildPeekDocument(input([PRODUCT_SEASON, PRIOR, PRIOR - 1]));
    expect(document.seasons.map((season) => season.season)).toEqual([PRODUCT_SEASON, PRIOR, PRIOR - 1]);
  });

  it("derives availableSeasons from the seasons it actually holds numbers for", () => {
    const document = buildPeekDocument(input([PRIOR, PRIOR - 1]));
    expect(document.availableSeasons).toEqual([PRIOR, PRIOR - 1]);
  });

  it("states its own as_of and basis", () => {
    const document = buildPeekDocument(input([PRIOR]));
    expect(document.asOf).toBe("2026-09-07T12:00:00.000Z");
    expect(document.basis.scoringHash).toBe("hash_ppr");
    expect(document.basis.factsAsOf).toBe("2026-09-07T04:00:00.000Z");
  });

  it("carries absence for a player with no season at all", () => {
    const document = buildPeekDocument(input([]));
    expect(document.availableSeasons).toEqual([]);
    expect(document.seasons).toEqual([]);
  });
});

describe("hydratePeekDocument", () => {
  const document = buildPeekDocument(input([PRODUCT_SEASON, PRIOR]));

  it("applies the league facts the document was built without", () => {
    const body = hydratePeekDocument(document, { ownedBy: null, isMockLeague: true, seasonWeeks: 14, requestedSeason: undefined });
    expect(body.ownedBy).toBeNull();
    expect(body.isMockLeague).toBe(true);
  });

  it("answers for the requested season when the document offers it", () => {
    const body = hydratePeekDocument(document, { ...LIVE, requestedSeason: PRIOR });
    expect(body.season).toBe(PRIOR);
    expect(body.weeks).toEqual(document.seasons[1]!.weeks);
  });

  it("falls back to the newest available season for one it does not hold", () => {
    expect(hydratePeekDocument(document, { ...LIVE, requestedSeason: 1999 }).season).toBe(PRODUCT_SEASON);
  });

  it("surfaces the document's own as_of", () => {
    expect(hydratePeekDocument(document, LIVE).asOf).toBe("2026-09-07T12:00:00.000Z");
  });

  it("carries the law registry rather than a frozen copy", () => {
    expect(hydratePeekDocument(document, LIVE).laws.length).toBeGreaterThan(0);
  });

  it("caps the current season's week axis at the league's own schedule length", () => {
    const body = hydratePeekDocument(document, { ...LIVE, seasonWeeks: 2, requestedSeason: PRODUCT_SEASON });
    expect(body.weeks.map((week) => week.week)).toEqual([1, 2]);
    expect(body.log.every((row) => row.week <= 2)).toBe(true);
    expect(body.totals!.games).toBe(2);
    expect(body.pointsPerGame).toBe(15);
  });

  it("drops the points-per-game comparison when the cap dropped a week, rather than tinting against the wrong population", () => {
    const body = hydratePeekDocument(document, { ...LIVE, seasonWeeks: 2, requestedSeason: PRODUCT_SEASON });
    expect(body.pointsPerGamePercentile).toBeNull();
  });

  it("keeps the comparison when the cap dropped nothing", () => {
    const body = hydratePeekDocument(document, { ...LIVE, seasonWeeks: 14, requestedSeason: PRODUCT_SEASON });
    expect(body.pointsPerGamePercentile).toBe(0.8);
  });

  it("leaves a prior season uncapped, since a finished season has no future to cap against", () => {
    const body = hydratePeekDocument(document, { ...LIVE, seasonWeeks: 2, requestedSeason: PRIOR });
    expect(body.weeks).toHaveLength(4);
  });

  it("renders absence for a document with no seasons at all", () => {
    const body = hydratePeekDocument(buildPeekDocument(input([])), LIVE);
    expect(body.availableSeasons).toEqual([]);
    expect(body.season).toBe(PRODUCT_SEASON);
    expect(body.weeks).toEqual([]);
    expect(body.totals).toBeNull();
  });
});

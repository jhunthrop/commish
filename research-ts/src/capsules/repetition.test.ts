import { describe, expect, it } from "vitest";
import { playersSayingStock, sentencesToAvoid, stockSentences, type NarrativeRow } from "./repetition";

const STOCK = "He is a high floor play with weekly upside.";

/** `count` players all saying `sentence`, plus one distinct sentence each so the row is realistic. */
function rowsSaying(sentence: string, count: number, offset = 0): readonly NarrativeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${offset + index}`,
    narrative: { call: sentence, trend: `His own line number ${offset + index}.` },
  }));
}

/** Players who share no sentence with anybody, the healthy board this check should stay quiet on. */
function uniqueRows(count: number, offset: number): readonly NarrativeRow[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${offset + index}`,
    narrative: { call: `A line only player ${offset + index} would ever get.` },
  }));
}

describe("stockSentences", () => {
  it("flags a sentence over the share and names every player saying it", () => {
    const rows = [...rowsSaying(STOCK, 5), ...rowsSaying("A different line entirely.", 95, 100)];
    const findings = stockSentences(rows, 0.02);

    const stock = findings.find((finding) => finding.sentence.startsWith("he is a high floor"));
    expect(stock).toBeDefined();
    expect(stock!.playerIds).toHaveLength(5);
    expect(stock!.share).toBeCloseTo(0.05, 10);
    expect(playersSayingStock(findings)).toContain("p0");
  });

  it("leaves a sentence at or under the share alone", () => {
    const rows = [...rowsSaying(STOCK, 2), ...rowsSaying("A different line entirely.", 98, 100)];
    // Two of a hundred is exactly the share, and the line is not over it.
    expect(stockSentences(rows, 0.02).some((finding) => finding.sentence.startsWith("he is a high floor"))).toBe(false);
  });

  it("counts a sentence once per player, however many slots he says it in", () => {
    const rows: readonly NarrativeRow[] = [
      { playerId: "p1", narrative: { call: STOCK, trend: STOCK, books: STOCK } },
      { playerId: "p2", narrative: { call: STOCK } },
      ...uniqueRows(98, 100),
    ];
    expect(stockSentences(rows, 0.005).find((finding) => finding.sentence.startsWith("he is a high floor"))!.playerIds).toEqual(["p1", "p2"]);
  });

  it("counts sentences, not slots, so a stock second sentence is caught too", () => {
    const rows: readonly NarrativeRow[] = Array.from({ length: 10 }, (_, index) => ({
      playerId: `p${index}`,
      narrative: { call: `Something specific about player ${index}. ${STOCK}` },
    }));
    expect(stockSentences(rows, 0.02).some((finding) => finding.sentence.startsWith("he is a high floor"))).toBe(true);
  });

  it("ignores players with no narrative at all rather than dividing by them", () => {
    const rows: readonly NarrativeRow[] = [...rowsSaying(STOCK, 3), { playerId: "none", narrative: null }];
    const findings = stockSentences(rows, 0.02);
    expect(findings[0]!.share).toBeCloseTo(1, 10);
    expect(stockSentences([{ playerId: "none", narrative: null }], 0.02)).toEqual([]);
  });

  it("never flags a sentence only one player says, however small the board", () => {
    expect(stockSentences(rowsSaying(STOCK, 1), 0.02)).toEqual([]);
  });
});

describe("sentencesToAvoid", () => {
  it("quotes the worst offenders first and caps the list", () => {
    const rows = [...rowsSaying(STOCK, 20), ...rowsSaying("Another stock line.", 10, 100), ...uniqueRows(70, 200)];
    const avoid = sentencesToAvoid(stockSentences(rows, 0.02));
    // Quoted in the words a player actually carries, capital and full stop included, never in the
    // normalized form the count is taken over (review, MINOR).
    expect(avoid[0]).toBe(STOCK);
    expect(avoid.length).toBeLessThanOrEqual(8);
  });
});

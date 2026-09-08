import { describe, expect, it } from "vitest";
import { CAPSULE_CONFIG } from "./config";
import {
  containsStem,
  measureSameness,
  openerFamily,
  phrasesToAvoid,
  playersToRegenerateForSameness,
  samenessOverThreshold,
  toursTheSheet,
  type SamenessRow,
} from "./sameness";

/**
 * THE BOARD-LEVEL SAMENESS MEASURE (refrains round, 2026-09-07). The founder read the production
 * peeks and every one opened the same way, carried the same three stock sentences and toured the
 * same three usage ranks. `repetition.ts` counts whole sentences, so a refrain with a different
 * name or number in it passed. These pin the three measures that catch what that one misses.
 */

/** A letters-only token unique to the player, so a default row's opener is its own family: a digit
 *  would be masked to `#` and every default row would open the same way. */
function uniqueWord(playerId: string): string {
  return playerId.replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!);
}

function row(over: Partial<SamenessRow> & { readonly playerId: string }): SamenessRow {
  const word = uniqueWord(over.playerId);
  return {
    name: null,
    bodyCompact: `${word} alone gets this read, nothing shared with anybody else on the board.`,
    bodyFull: `${word} again alone gets this long read, nothing shared with anybody else at all.`,
    source: "llm",
    narrative: null,
    ...over,
  };
}

const TOURING =
  "Last year he played 84.8% of the snaps, RB2 among 40 qualifying running backs. His target share was 26.3%, RB2 among those same 40, and his red-zone share of touches sat at 19.0%, RB5 among 40. The call is a buy.";

describe("openerFamily", () => {
  it("masks the player's own name, any number and any mid-sentence capitalised word, and keeps the frame", () => {
    expect(openerFamily("Let's talk about Bijan Robinson, because the price is wrong.", "Bijan Robinson")).toBe("let's talk about _");
    expect(openerFamily("Bijan Robinson is the engine of that offense.", "Bijan Robinson")).toBe("_ _ is the");
    expect(openerFamily("Buy Jahmyr Gibbs at 12.5, the price is wrong.", "Jahmyr Gibbs")).toBe("buy _ _ at");
    expect(openerFamily("At 26.3% of the targets he is the offense.", null)).toBe("at # of the");
  });

  it("masks an unknown two-word name at the very start by its capitalised shape", () => {
    expect(openerFamily("Justin Jefferson is going a round late.", null)).toBe("_ _ is going");
  });

  it("reads an empty or one-word text without throwing", () => {
    expect(openerFamily("", null)).toBe("");
    expect(openerFamily("Pass.", null)).toBe("pass");
  });
});

describe("containsStem", () => {
  it("matches a stem across punctuation, case and apostrophes, on word boundaries only", () => {
    expect(containsStem("Here's the honest worry: he was hurt twice.", "here's the honest worry")).toBe(true);
    expect(containsStem("HERE'S THE HONEST WORRY.", "here's the honest worry")).toBe(true);
    expect(containsStem("The band says most seasons land between 150 and 190.", "the band says")).toBe(true);
    expect(containsStem("Nobody said the band says anything.", "band say")).toBe(false);
  });
});

describe("toursTheSheet", () => {
  it("flags a read that cites all three usage shares with their ranks", () => {
    expect(toursTheSheet(TOURING)).toBe(true);
  });

  it("leaves a read that picks one share, or cites the shares without ranks, alone", () => {
    expect(toursTheSheet("He played 84.8% of the snaps, RB2 among 40 qualifying backs, and that is the whole case.")).toBe(false);
    expect(toursTheSheet("Snap share 84.8%, target share 26.3%, red-zone share 19.0%. He did everything.")).toBe(false);
  });
});

describe("measureSameness", () => {
  const stem = CAPSULE_CONFIG.repetition.refrainStems[0]!;

  it("measures opener families, refrains and sheet-touring as shares of the llm capsules", () => {
    const rows: SamenessRow[] = [
      row({ playerId: "p1", name: "Bijan Robinson", bodyCompact: "Let's talk about Bijan Robinson, because his role is the case.", bodyFull: `Something else entirely. ${stem}.` }),
      row({ playerId: "p2", name: "Jahmyr Gibbs", bodyCompact: "Let's talk about Jahmyr Gibbs, because he is the whole offense.", bodyFull: TOURING }),
      row({ playerId: "p3", name: "Rashad Long", bodyCompact: "Rashad Long is going a round late and that is the case.", narrative: { call: `${stem}, and it is real.` } }),
      row({ playerId: "p4", name: "Some Body", bodyCompact: "Nothing here repeats at all.", bodyFull: "Nothing here repeats at all either." }),
      // A template capsule is identical by design and never counts toward the writer's sameness.
      row({ playerId: "t1", source: "template", bodyCompact: "Let's talk about Template Man, because he is one too." }),
    ];

    const report = measureSameness(rows);
    expect(report.capsules).toBe(4);

    const opener = report.openers.find((finding) => finding.key === "let's talk about _");
    expect(opener?.playerIds).toEqual(["p1", "p2"]);
    expect(opener?.share).toBeCloseTo(0.5, 10);
    // Quoted with the name masked, so the example can go into another player's prompt.
    expect(opener?.example).toBe("Let's talk about [name]");

    const refrain = report.refrains.find((finding) => finding.key === stem);
    // Counted once per player whatever part carries it: p1 in the full read, p3 in a narrative slot.
    expect(refrain?.playerIds).toEqual(["p1", "p3"]);
    expect(refrain?.share).toBeCloseTo(0.5, 10);

    expect(report.sheetTouring.playerIds).toEqual(["p2"]);
    expect(report.sheetTouring.share).toBeCloseTo(0.25, 10);
  });

  it("counts a player once for an opener family his two reads both use", () => {
    const rows = [row({ playerId: "p1", bodyCompact: "So the call is a fade.", bodyFull: "So the call is a pass." }), row({ playerId: "p2" })];
    expect(measureSameness(rows).openers.find((finding) => finding.key === "so the call is")?.playerIds).toEqual(["p1"]);
  });

  it("reports every configured refrain, at zero when nobody says it", () => {
    const report = measureSameness([row({ playerId: "p1" })]);
    expect(report.refrains.map((finding) => finding.key)).toEqual([...CAPSULE_CONFIG.repetition.refrainStems]);
    expect(report.refrains.every((finding) => finding.share === 0)).toBe(true);
  });

  it("measures an empty board as zero capsules with no division by nothing", () => {
    const report = measureSameness([]);
    expect(report.capsules).toBe(0);
    expect(report.openers).toEqual([]);
    expect(report.sheetTouring.share).toBe(0);
  });
});

describe("the thresholds", () => {
  const stem = CAPSULE_CONFIG.repetition.refrainStems[0]!;
  /** Twenty players: two share an opener (10%, at the line), three say a refrain (15%, over it),
   *  and six tour the sheet (30%, over the 25% line). */
  function board(): readonly SamenessRow[] {
    return Array.from({ length: 20 }, (_, index) => {
      const id = `p${index}`;
      const word = uniqueWord(id);
      return row({
        playerId: id,
        bodyCompact: index < 2 ? `Let's talk about player ${index}.` : `${word} opens its own way here.`,
        bodyFull: index < 3 ? `${word} first. ${stem} is real.` : index < 9 ? `${word} ${TOURING}` : `${word} long read here.`,
      });
    });
  }

  it("flags only what is strictly over its own threshold", () => {
    const over = samenessOverThreshold(measureSameness(board()));
    expect(over.openers).toEqual([]);
    // Every flagged stem is one the three players actually wrote: the first stem, and any shorter
    // configured stem it contains ("here's the honest worry" carries "the honest worry").
    expect(over.refrains.map((finding) => finding.key)).toContain(stem);
    for (const flagged of over.refrains) expect(containsStem(stem, flagged.key)).toBe(true);
    expect(over.sheetTouring).toBe(true);
  });

  it("queues every player carrying a flagged refrain or a flagged opener, and the tourers only when touring is over the line", () => {
    const queued = playersToRegenerateForSameness(measureSameness(board()));
    expect(queued).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
  });

  it("queues nobody on a board under every line", () => {
    const quiet = Array.from({ length: 20 }, (_, index) => row({ playerId: `p${index}` }));
    expect(playersToRegenerateForSameness(measureSameness(quiet))).toEqual([]);
  });

  it("quotes the flagged refrains and an example of each flagged opener into the next prompt", () => {
    const rows = [...board(), row({ playerId: "p20", bodyCompact: "Let's talk about player twenty." })];
    const phrases = phrasesToAvoid(measureSameness(rows));
    expect(phrases).toContain(stem);
    expect(phrases.some((phrase) => phrase.startsWith("Let's talk about"))).toBe(true);
  });

  it("holds the thresholds the refrains round set", () => {
    expect(CAPSULE_CONFIG.repetition).toMatchObject({ openerWords: 4, maxOpenerFamilyShare: 0.1, maxRefrainShare: 0.1, maxSheetTouringShare: 0.25 });
  });
});

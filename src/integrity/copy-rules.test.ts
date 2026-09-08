import { describe, expect, it } from "vitest";
import { INTEGRITY_CONFIG } from "./config";
import { copyViolations, tradingVocabularyViolations } from "./copy-rules";

describe("copyViolations", () => {
  it("passes copy that breaks nothing", () => {
    expect(copyViolations("We made your pick for you. Set your queue before your next draft.")).toEqual([]);
  });

  it("catches the en dash as well as the em dash, which is the half every other sweep in this repo misses", () => {
    expect(copyViolations("We made your pick — from your queue.")).toEqual([{ rule: "dash", found: "—" }]);
    expect(copyViolations("We made your pick – from your queue.")).toEqual([{ rule: "dash", found: "–" }]);
    expect(copyViolations("Two — of them –.")).toHaveLength(2);
  });

  it("catches every accusatory term in the config, whatever its casing", () => {
    for (const term of INTEGRITY_CONFIG.notices.accusatoryTerms) {
      expect(copyViolations(`Your ${term.toUpperCase()} was noted.`)).toContainEqual({ rule: "accusatory", found: term });
    }
  });

  it("catches every passive construction in the config", () => {
    for (const phrase of INTEGRITY_CONFIG.notices.passiveConstructions) {
      expect(copyViolations(`The lineup ${phrase} last night.`)).toContainEqual({ rule: "passive", found: phrase });
    }
  });

  it("reports every rule a single sentence breaks, so a red sweep names all of it at once", () => {
    const violations = copyViolations("Your review was removed — a violation of the rules.");
    expect(violations.map((v) => v.rule).sort()).toEqual(["accusatory", "dash", "passive"]);
  });

  it("is stateless across calls, which a global regex is not by default", () => {
    // `/[—–]/g` carries `lastIndex` between `.exec` calls. `matchAll` resets it; a hand-rolled
    // `.test()` loop would not, and the second sweep in a run would silently start mid-string.
    const dashed = "A — B";
    expect(copyViolations(dashed)).toEqual(copyViolations(dashed));
  });

  it("catches the mock draft's bot-vocabulary ban (Phase 4.5), whatever its casing", () => {
    for (const term of ["ai opponent", "smart ai", "learns from", "machine learning"]) {
      expect(copyViolations(`Your ${term.toUpperCase()} adapts every round.`)).toContainEqual({
        rule: "forbiddenVocabulary",
        found: term,
      });
    }
  });

  it("passes the mock draft's own honest bot copy", () => {
    expect(copyViolations("Coach Parker is a practice opponent, seeded for this room only.")).toEqual([]);
  });
});

describe("tradingVocabularyViolations", () => {
  it("passes copy written in fantasy football's own words", () => {
    expect(tradingVocabularyViolations("Drafters take him 25 picks later. He is a steal at ADP 99.7.")).toEqual([]);
    expect(tradingVocabularyViolations("Kickers are ranked by ADP because we do not project this position.")).toEqual([]);
  });

  it("catches the trader's words, whatever their casing or inflection", () => {
    expect(tradingVocabularyViolations("The market has him at 99.7.")).toEqual([{ rule: "tradingVocabulary", found: "market" }]);
    expect(tradingVocabularyViolations("Priced 17 picks early.")).toEqual([{ rule: "tradingVocabulary", found: "Priced" }]);
    expect(tradingVocabularyViolations("The market is underpricing him.").map((v) => v.found)).toEqual(["market", "underpricing"]);
    for (const word of ["buy", "sell", "fade", "undervalued", "overvalued", "discount", "dividend", "premium"]) {
      expect(tradingVocabularyViolations(`A ${word} at this pick.`)).toContainEqual({ rule: "tradingVocabulary", found: word });
    }
  });

  it("catches the two-word phrases the ruling named", () => {
    expect(tradingVocabularyViolations("He should trade at a second-round pick.")).toContainEqual({ rule: "tradingVocabulary", found: "trade at" });
    expect(tradingVocabularyViolations("The price is wrong.")).not.toEqual([]);
    expect(tradingVocabularyViolations("Our number vs the market.")).not.toEqual([]);
  });

  it("leaves fantasy's own words alone: trade, value, points over replacement, reach, steal", () => {
    expect(tradingVocabularyViolations("Propose a trade. His value over replacement is 40 points. A reach, not a steal.")).toEqual([]);
  });

  it("keeps the allowlist: the buy-in, the TE premium format, the premium research product and the privacy sentence", () => {
    expect(tradingVocabularyViolations("Your buy-in sits in your wallet until the draft fires.")).toEqual([]);
    expect(tradingVocabularyViolations("PPR with a TE premium")).toEqual([]);
    expect(tradingVocabularyViolations("Premium research, labeled as research")).toEqual([]);
    expect(tradingVocabularyViolations("This platform does not sell personal information to anyone.")).toEqual([]);
  });

  it("ignores the internal identifiers a source scan reads as literals", () => {
    expect(tradingVocabularyViolations("market_anchor")).toEqual([]);
    expect(tradingVocabularyViolations("market_unlisted")).toEqual([]);
    expect(tradingVocabularyViolations("board-market-order-note")).toEqual([]);
  });

  it("is stateless across calls", () => {
    const text = "The market price.";
    expect(tradingVocabularyViolations(text)).toEqual(tradingVocabularyViolations(text));
  });
});

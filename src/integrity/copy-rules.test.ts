import { describe, expect, it } from "vitest";
import { INTEGRITY_CONFIG } from "./config";
import { copyViolations } from "./copy-rules";

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
});

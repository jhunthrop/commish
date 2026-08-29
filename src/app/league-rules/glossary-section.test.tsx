import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { GLOSSARY, type TermKey } from "@/help/glossary";
import { copyViolations } from "@/integrity/copy-rules";
import { GlossarySection, LEAGUE_RULES_GLOSSARY_TERMS } from "./glossary-section";

describe("GlossarySection", () => {
  // THE COMPLETENESS GATE (Sunday v5, 2026-08-28). With `InfoTip` retired by the no-tips ruling,
  // this section is the only place in the product a `GLOSSARY` definition reaches a reader — so a
  // term added to the registry and forgotten here is a word the product shows a manager and
  // explains nowhere. Set equality in both directions, rather than a count: a count passes the
  // moment somebody swaps one term for another.
  it("carries every term the registry defines, and invents none", () => {
    expect([...LEAGUE_RULES_GLOSSARY_TERMS].sort()).toEqual((Object.keys(GLOSSARY) as TermKey[]).sort());
    expect(new Set(LEAGUE_RULES_GLOSSARY_TERMS).size).toBe(LEAGUE_RULES_GLOSSARY_TERMS.length);
  });

  it("renders every term with an anchor a TermLink can land on", async () => {
    await renderSurface(<GlossarySection />, ({ container }) => {
      for (const key of LEAGUE_RULES_GLOSSARY_TERMS) {
        const target = container.querySelector(`#term-${key}`);
        expect(target, `no anchor target for "${key}"`).not.toBeNull();
        expect(target?.textContent).toContain(GLOSSARY[key].detail);
      }
    });
  });

  it("reads the full detail line, not just the short one InfoTip's guided mode prints", async () => {
    await renderSurface(<GlossarySection />, () => {
      expect(screen.getByText(GLOSSARY.ppr.detail)).toBeInTheDocument();
    });
  });

  it("says nothing that breaks the house copy rules, now that it renders unconditionally", async () => {
    await renderSurface(<GlossarySection />, ({ container }) => {
      expect(copyViolations(container.textContent ?? "")).toEqual([]);
    });
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<GlossarySection />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

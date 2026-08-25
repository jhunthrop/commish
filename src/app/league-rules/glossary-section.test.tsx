import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { GLOSSARY } from "@/help/glossary";
import { copyViolations } from "@/integrity/copy-rules";
import { GlossarySection, LEAGUE_RULES_GLOSSARY_TERMS } from "./glossary-section";

describe("GlossarySection", () => {
  it("renders every one of this page's seven terms with an anchor a TermLink can land on", async () => {
    await renderSurface(<GlossarySection />, ({ container }) => {
      expect(LEAGUE_RULES_GLOSSARY_TERMS).toHaveLength(7);
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

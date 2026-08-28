import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { Verdict } from "../lib/verdict";
import { VerdictChip } from "./verdict-chip";

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    kind: "steal",
    slip: 11,
    value: "+11",
    comparison: { percentile: 0.94, population: "picks in this room" },
    ...over,
  };
}

describe("VerdictChip", () => {
  it("says the slip and the word, in that order — both themes, axe-clean", async () => {
    await renderSurface(<VerdictChip verdict={verdict()} />, async ({ container, getByText }) => {
      expect(getByText("+11")).toBeInTheDocument();
      expect(getByText("steal")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("keeps the minus sign on a reach, because the sign is the fact", async () => {
    const reach = verdict({ kind: "reach", slip: -12, value: "-12", comparison: { percentile: 0.04, population: "picks in this room" } });
    await renderSurface(<VerdictChip verdict={reach} />, ({ getByText }) => {
      expect(getByText("-12")).toBeInTheDocument();
      expect(getByText("reach")).toBeInTheDocument();
    });
  });

  /**
   * The quiet rule. "You took him about where he was ranked" is the ABSENCE of a verdict, and it
   * renders as nothing for the same reason `neutral` is `textPrimary`: sixty pool rows each
   * printing "0 even" would make the screen louder without making one true thing more legible,
   * which is exactly the change rule 6 rejects.
   */
  it("says nothing for an even pick, and nothing for a pick it cannot judge", async () => {
    await renderSurface(<VerdictChip verdict={verdict({ kind: "even", slip: 0, value: "0" })} />, ({ container }) => {
      expect(container.querySelector("[data-magnitude]")).toBeNull();
    });
    await renderSurface(<VerdictChip verdict={null} />, ({ container }) => {
      expect(container.querySelector("[data-magnitude]")).toBeNull();
    });
  });

  /** The colourblind gate, at the chip: the slip reads plainly, the caret names the side and the
   *  weight step names the distance. Strip the colour and a manager still ranks their own draft
   *  correctly. */
  it("carries the caret and the weight step, not colour alone", async () => {
    await renderSurface(<VerdictChip verdict={verdict()} />, ({ container }) => {
      const root = container.querySelector("[data-magnitude]")!;
      expect(root.getAttribute("data-magnitude")).toBe("strong");
      expect(root.textContent).toContain("▲");
      expect(container.querySelector(".font-semibold")).not.toBeNull();
    });
  });

  /** An uncompared verdict (the first pick of a draft: nothing to rank it against yet) still
   *  states its slip. The number never depends on the colour being available. */
  it("still states the slip when there is no population to colour it by", async () => {
    await renderSurface(<VerdictChip verdict={verdict({ comparison: undefined })} />, ({ container, getByText }) => {
      expect(getByText("+11")).toBeInTheDocument();
      expect(container.querySelector("[data-magnitude]")!.getAttribute("data-magnitude")).toBe("neutral");
    });
  });

  /** It renders inside a one-line inline band (`PickWire`), so it must never be a block. */
  it("is an inline span, so a truncating one-line band can hold it", async () => {
    await renderSurface(<VerdictChip verdict={verdict()} />, ({ container }) => {
      expect(container.querySelector("[data-magnitude]")!.tagName).toBe("SPAN");
    });
  });
});

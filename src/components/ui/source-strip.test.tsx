import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { NOT_STARTED_DASH } from "./game-state-chip";
import { SourceStrip, type SourceValue } from "./source-strip";

const SOURCES: readonly SourceValue[] = [
  { label: "RB", value: "3" },
  { label: "ADP", value: "4.0" },
  { label: "Experts", value: null },
  { label: "Model", value: null },
  { label: "PPG", value: "18.2", comparison: { percentile: 0.92, population: "running backs this season" } },
];

describe("SourceStrip", () => {
  it("names every source inline and adds no heading, legend or caption of its own", async () => {
    await renderSurface(<SourceStrip label="Where he is ranked, by source" sources={SOURCES} />, ({ getByRole, queryByRole }) => {
      const strip = getByRole("group", { name: "Where he is ranked, by source" });
      expect(strip).toBeInTheDocument();
      // The source names ARE the legend. A heading above this row would be the product
      // explaining a row that explains itself.
      expect(queryByRole("heading")).not.toBeInTheDocument();
      for (const label of ["RB", "ADP", "Experts", "Model", "PPG"]) {
        expect(strip).toHaveTextContent(label);
      }
    });
  });

  it("prints a dash for a source this product cannot reach, and never a zero", async () => {
    await renderSurface(<SourceStrip label="Sources" sources={SOURCES} />, ({ getAllByText, queryByText }) => {
      expect(getAllByText(NOT_STARTED_DASH)).toHaveLength(2);
      expect(queryByText("0")).not.toBeInTheDocument();
      expect(queryByText("0.0")).not.toBeInTheDocument();
    });
  });

  it("refuses to tint an absent number, whatever the caller passes", async () => {
    // A colour is a claim about where a value sits in a population, and there is no value. The
    // strip drops the comparison itself rather than trusting the call site to have dropped it.
    const lying: readonly SourceValue[] = [{ label: "Model", value: null, comparison: { percentile: 1, population: "running backs" } }];
    await renderSurface(<SourceStrip label="Sources" sources={lying} />, ({ container }) => {
      expect(container.querySelector("[data-magnitude]")).toHaveAttribute("data-magnitude", "neutral");
    });
  });

  it("tints only the cell whose caller stated a real population", async () => {
    await renderSurface(<SourceStrip label="Sources" sources={SOURCES} />, ({ container }) => {
      const steps = [...container.querySelectorAll("[data-magnitude]")].map((node) => node.getAttribute("data-magnitude"));
      expect(steps).toEqual(["neutral", "neutral", "neutral", "neutral", "strong"]);
    });
  });

  it("has no axe violations in either theme", async () => {
    await renderSurface(<SourceStrip label="Sources" sources={SOURCES} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PlayerCapsuleView } from "@/capsules/store";
import { TEMPLATE_CAPSULE_NOTE } from "@/capsules/template";
import { ReadCard } from "./read-card";

const LLM: PlayerCapsuleView = { bodyCompact: "The short version.", bodyFull: "The long, uncapped version.", source: "llm", narrative: null };
const TEMPLATE: PlayerCapsuleView = { bodyCompact: "The template's own sentence.", bodyFull: "The template's own sentence.", source: "template", narrative: null };

describe("ReadCard", () => {
  it("renders nothing when the sweep has not reached him at all", () => {
    const { container } = render(<ReadCard capsule={null} variant="full" />);
    expect(container).toBeEmptyDOMElement();
    const { container: undefinedContainer } = render(<ReadCard capsule={undefined} variant="compact" />);
    expect(undefinedContainer).toBeEmptyDOMElement();
  });

  it("states the compact body for the compact variant, even when a real full body exists", () => {
    const { container } = render(<ReadCard capsule={LLM} variant="compact" />);
    expect(container.textContent).toContain("The short version.");
    expect(container.textContent).not.toContain("The long, uncapped version.");
  });

  it("states the full body for the full variant, when the capsule is a genuine LLM write-up", () => {
    const { container } = render(<ReadCard capsule={LLM} variant="full" />);
    expect(container.textContent).toContain("The long, uncapped version.");
    expect(container.textContent).not.toContain("The short version.");
  });

  it("falls back to the compact body for the full variant when the source is template, labeled honestly", () => {
    const { container } = render(<ReadCard capsule={TEMPLATE} variant="full" />);
    expect(container.textContent).toContain("The template's own sentence.");
    expect(container.textContent).toContain(TEMPLATE_CAPSULE_NOTE);
  });

  /** THE FLOOR STOPS PROMISING (overruns round, 2026-09-08). "The written read is on its way" was
   *  a constant, said to a reader whether or not a write was actually queued for him, and a player
   *  demoted on a fixable miss showed it for days. The note now states what the text is and no
   *  more; a promise would need a real queue check the render site does not have. */
  it("states what the text is and promises nothing", () => {
    expect(TEMPLATE_CAPSULE_NOTE).toBe("A summary from the numbers.");
    const { container } = render(<ReadCard capsule={TEMPLATE} variant="compact" />);
    expect(container.textContent).not.toContain("on its way");
    expect(container.textContent).not.toContain("overnight");
  });

  it("prints no honest-fallback note for a genuine llm capsule", () => {
    const { container } = render(<ReadCard capsule={LLM} variant="full" />);
    expect(container.textContent).not.toContain(TEMPLATE_CAPSULE_NOTE);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<ReadCard capsule={LLM} variant="full" />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

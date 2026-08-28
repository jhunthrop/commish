import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Pill } from "./pill";

describe("Pill", () => {
  it("states its figure in the mono face, so a ticking count cannot jitter the row", async () => {
    // The one thing `Badge` is wrong about for this job: a badge labels a state in the body
    // face, a pill states a NUMBER, and tabular figures are why 3 → 2 → 1 does not shift the
    // words beside it.
    await renderSurface(<Pill>3 yet to play</Pill>, ({ getByText }) => {
      expect(getByText("3 yet to play").className).toContain("font-mono");
    });
  });

  it("keeps one pill geometry in the product by building on Badge", async () => {
    await renderSurface(<Pill>3 yet to play</Pill>, ({ getByText }) => {
      const pill = getByText("3 yet to play");
      expect(pill.className).toContain("rounded-pill");
      expect(pill.className).toContain("whitespace-nowrap");
    });
  });

  it("spends the live family on hot, and nothing on neutral", async () => {
    // `hot` is real urgency — points that can still arrive, points that already didn't — in the
    // same pigment `GameStateChip`'s live state and the rail's my-turn morph already use.
    await renderSurface(<Pill tone="hot">18.4 on your bench</Pill>, ({ getByText }) => {
      expect(getByText("18.4 on your bench").className).toContain("text-negative");
    });
    await renderSurface(<Pill>3 yet to play</Pill>, ({ getByText }) => {
      expect(getByText("3 yet to play").className).toContain("text-text-muted");
      expect(getByText("3 yet to play").className).not.toContain("text-negative");
    });
  });

  it("is axe-clean in both themes, in both tones", async () => {
    await renderSurface(<Pill>3 yet to play</Pill>, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
    await renderSurface(<Pill tone="hot">18.4 on your bench</Pill>, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

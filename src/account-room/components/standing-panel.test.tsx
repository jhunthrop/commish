import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { StandingPanel } from "./standing-panel";

const ANY_PROPS = { seasons: 2, tier: "veteran" as const, verified: true };

describe("StandingPanel", () => {
  it("tells a manager their own standing, in seasons and in plain words", async () => {
    await renderSurface(<StandingPanel seasons={2} tier="veteran" verified />, ({ getByText }) => {
      expect(getByText("2 seasons finished on Commish")).toBeInTheDocument();
      expect(getByText("Every open league is available to you.")).toBeInTheDocument();
    });
  });

  it("says what a newer manager's standing opens, never what it costs them", async () => {
    // The tier axis exists to keep newer players with newer players. Framed as a refusal it reads
    // as a punishment for being new; framed as what it is, it is the reason their first league is
    // not twelve veterans.
    await renderSurface(<StandingPanel seasons={0} tier="newcomer" verified={false} />, ({ getByText }) => {
      expect(getByText("Leagues kept for newer players are open to you.")).toBeInTheDocument();
    });
  });

  it("says nothing at all about any other manager", async () => {
    // Ruling 30. This panel is about the reader. It is not the refused per-manager tag (D6)
    // wearing a different hat, and the test that keeps it that way is the one that asserts the
    // absence.
    await renderSurface(<StandingPanel {...ANY_PROPS} />, ({ container }) => {
      expect(container.textContent).not.toMatch(/other manager|in this league|compared/i);
    });
  });

  it("shows the verified badge only when verified, in both directions", async () => {
    await renderSurface(<StandingPanel {...ANY_PROPS} verified={false} />, ({ queryByText }) => {
      expect(queryByText("Verified")).not.toBeInTheDocument();
    });
    await renderSurface(<StandingPanel {...ANY_PROPS} verified />, ({ getByText }) => {
      expect(getByText("Verified")).toBeInTheDocument();
    });
  });

  it("is axe-clean in both themes, verified and not", async () => {
    for (const props of [ANY_PROPS, { ...ANY_PROPS, tier: "newcomer" as const, verified: false }]) {
      await renderSurface(<StandingPanel {...props} />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    }
  });
});

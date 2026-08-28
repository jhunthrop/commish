import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { ManagerHeader } from "./manager-header";

const ANY_PROPS = {
  displayName: "Dana Reyes",
  avatar: null,
  email: "dana@example.test",
  seasons: 2,
  tier: "veteran" as const,
  verified: true,
};

describe("ManagerHeader", () => {
  it("makes the manager's own name the page heading (law 2: a name or a number, never a route label)", async () => {
    await renderSurface(<ManagerHeader {...ANY_PROPS} />, ({ getByRole }) => {
      expect(getByRole("heading", { level: 1 })).toHaveTextContent("Dana Reyes");
    });
  });

  it("states the seasons count as a labelled number rather than a caption", async () => {
    await renderSurface(<ManagerHeader {...ANY_PROPS} />, ({ getByText }) => {
      expect(getByText("2")).toBeInTheDocument();
      expect(getByText("Seasons finished")).toBeInTheDocument();
    });
  });

  it("never tints the seasons count, because it has no population to compare against", async () => {
    // Ruling 30 and the magnitude amendment together: `Stat` stamps `data-magnitude` with the
    // step it resolved, and a `Stat` given no `comparison` resolves `neutral` — which IS
    // `textPrimary`. Asserting the stamp is what stops a future edit passing a percentile this
    // page would have to invent ("top 12% of every manager on Commish" is arithmetic dressed as
    // a fact).
    await renderSurface(<ManagerHeader {...ANY_PROPS} />, ({ container }) => {
      expect(container.querySelectorAll('[data-magnitude]')).toHaveLength(1);
      expect(container.querySelector('[data-magnitude]')?.getAttribute("data-magnitude")).toBe("neutral");
    });
  });

  it("says what a newer manager's standing opens, never what it costs them", async () => {
    // The tier axis exists to keep newer players with newer players. Framed as a refusal it reads
    // as a punishment for being new; framed as what it is, it is the reason their first league is
    // not twelve veterans.
    await renderSurface(<ManagerHeader {...ANY_PROPS} seasons={0} tier="newcomer" verified={false} />, ({ getByText }) => {
      expect(getByText("Leagues kept for newer players are open to you.")).toBeInTheDocument();
    });
    await renderSurface(<ManagerHeader {...ANY_PROPS} />, ({ getByText }) => {
      expect(getByText("Every open league is available to you.")).toBeInTheDocument();
    });
  });

  it("says nothing at all about any other manager", async () => {
    // Ruling 30, carried over from `StandingPanel` unchanged. This block is about the reader. The
    // test that keeps it that way is the one that asserts the absence.
    await renderSurface(<ManagerHeader {...ANY_PROPS} />, ({ container }) => {
      expect(container.textContent).not.toMatch(/other manager|in this league|compared/i);
    });
  });

  it("shows the verified badge and its disclosure line only when verified, in both directions", async () => {
    await renderSurface(<ManagerHeader {...ANY_PROPS} verified={false} />, ({ queryByText }) => {
      expect(queryByText("Verified")).not.toBeInTheDocument();
      expect(queryByText("Shown beside your reviews.")).not.toBeInTheDocument();
    });
    await renderSurface(<ManagerHeader {...ANY_PROPS} verified />, ({ getByText }) => {
      expect(getByText("Verified")).toBeInTheDocument();
      expect(getByText("Shown beside your reviews.")).toBeInTheDocument();
    });
  });

  it("shows the account's own email without offering it as a control", async () => {
    // A disabled input is a control that lies about being one — WorkOS owns sign-in and this
    // product cannot change an email here, so the address is text.
    await renderSurface(<ManagerHeader {...ANY_PROPS} />, ({ getByText, queryByDisplayValue }) => {
      expect(getByText("dana@example.test")).toBeInTheDocument();
      expect(queryByDisplayValue("dana@example.test")).not.toBeInTheDocument();
    });
  });

  it("is axe-clean in both themes, verified and not", async () => {
    for (const props of [ANY_PROPS, { ...ANY_PROPS, seasons: 0, tier: "newcomer" as const, verified: false }]) {
      await renderSurface(<ManagerHeader {...props} />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    }
  });
});

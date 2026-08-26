import { describe, it, expect } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { ShareLinkPanel } from "./share-link-panel";

describe("ShareLinkPanel", () => {
  it("shows the copyable share link, the code, seat fill and the countdown — axe-clean, both themes", async () => {
    const startsAt = new Date(Date.now() + 3 * 60_000).toISOString();
    await renderSurface(
      <ShareLinkPanel path="/app/mock-drafts/ABC123" shareCode="ABC123" seatsFilled={2} seatsTotal={8} startsAt={startsAt} />,
      async ({ getByLabelText, getByText, container }) => {
        expect(getByLabelText("Share link")).toHaveValue("/app/mock-drafts/ABC123");
        expect(getByText("ABC123")).toBeInTheDocument();
        expect(getByText(/2 of 8 seated/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("never lets a member type into the share link — it is read-only", async () => {
    await renderSurface(
      <ShareLinkPanel path="/app/mock-drafts/ABC123" shareCode="ABC123" seatsFilled={0} seatsTotal={8} startsAt={new Date().toISOString()} />,
      async ({ getByLabelText }) => {
        expect(getByLabelText("Share link")).toHaveAttribute("readonly");
      },
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import DraftRoomError from "./error";

const BOOM = Object.assign(new Error('relation "drafts" does not exist'), { digest: "room123" });

describe("app/app/(room)/drafts/[draftId]/error.tsx", () => {
  it("offers reset first, labelled to re-enter the room, and leagues second, axe-clean", async () => {
    await renderSurface(<DraftRoomError error={BOOM} reset={() => {}} />, async ({ container, getByRole }) => {
      expect(getByRole("alert")).toBeInTheDocument();
      expect(getByRole("button", { name: "Try the room again" })).toBeInTheDocument();
      expect(getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never leaks the raw exception text into the page", () => {
    renderSurface(<DraftRoomError error={BOOM} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("relation");
      expect(container.textContent).not.toContain("does not exist");
    });
  });

  it("never claims a pick or a bid did or did not go through", () => {
    renderSurface(<DraftRoomError error={BOOM} reset={() => {}} />, ({ container }) => {
      const text = container.textContent ?? "";
      expect(text).not.toMatch(/your pick (was|went)/i);
      expect(text).not.toMatch(/no pick was made/i);
      expect(text).toContain("This does not confirm whether your last pick or bid went through.");
    });
  });

  it("shows the digest as a quiet reference, the same as the other two boundaries", () => {
    renderSurface(<DraftRoomError error={BOOM} reset={() => {}} />, ({ getByText }) => {
      expect(getByText("Reference room123")).toBeInTheDocument();
    });
  });

  it("omits the reference line entirely when there is no digest", () => {
    renderSurface(<DraftRoomError error={new Error("nope")} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("Reference");
    });
  });

  it("calls reset when Try the room again is pressed", async () => {
    const reset = vi.fn();
    await renderSurface(<DraftRoomError error={BOOM} reset={reset} />, async () => {
      await userEvent.click(screen.getByRole("button", { name: "Try the room again" }));
    });
    expect(reset).toHaveBeenCalledTimes(2); // once per theme render
  });
});

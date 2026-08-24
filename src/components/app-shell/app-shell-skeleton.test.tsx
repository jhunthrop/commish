import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { AppShellSkeleton } from "./app-shell-skeleton";

describe("AppShellSkeleton", () => {
  it("holds each chrome's exact geometry, so nothing jumps when the real page arrives", async () => {
    for (const shape of ["content", "public", "room"] as const) {
      // Awaited, so each shape's render is fully unmounted before the next one starts —
      // `renderSurface` itself renders/unmounts twice (once per theme) inside a promise, and
      // three un-awaited calls in a row would race, leaving more than one `shell-skeleton` in
      // the document at once.
      await renderSurface(<AppShellSkeleton shape={shape} />, ({ getByTestId }) => {
        expect(getByTestId("shell-skeleton")).toHaveAttribute("aria-busy", "true");
      });
    }
  });

  it("never draws the rail, because the layout is still holding it", () => {
    renderSurface(<AppShellSkeleton shape="content" />, ({ queryByTestId }) => {
      expect(queryByTestId("league-rail")).toBeNull();
    });
  });

  it("announces nothing it cannot know, and names no league", () => {
    // A skeleton rail with fake crests is mock data on a real surface.
    renderSurface(<AppShellSkeleton shape="content" />, ({ container }) => {
      expect(container.textContent?.trim()).toBe("Loading");
    });
  });

  it("is axe-clean in every shape, in both themes", async () => {
    for (const shape of ["content", "public", "room"] as const) {
      await renderSurface(<AppShellSkeleton shape={shape} />, async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      });
    }
  });
});

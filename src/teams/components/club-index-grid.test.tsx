import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { clubIndex } from "../club-index";
import { ClubIndexGrid } from "./club-index-grid";

describe("ClubIndexGrid", () => {
  it("gives every club one link at its own page, axe-clean in both themes", async () => {
    await renderSurface(<ClubIndexGrid rows={clubIndex()} />, async ({ container }) => {
      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(32);

      const lions = links.find((link) => link.textContent?.includes("Lions"));
      expect(lions).toBeDefined();
      expect(lions).toHaveAttribute("href", "/app/teams/DET");
      expect(within(lions!).getByText("Detroit")).toBeInTheDocument();
      expect(within(lions!).getByText("DET")).toBeInTheDocument();

      expect(await axe(container)).toHaveNoViolations();
    });
  });

  /** A club is one whole link inside its card, never a card that is itself the control — the
   *  `Card` primitive's own rule. */
  it("makes the link the control, one list row per club", async () => {
    await renderSurface(<ClubIndexGrid rows={clubIndex()} />, async () => {
      const rows = screen.getAllByRole("listitem");
      expect(rows).toHaveLength(32);
      for (const row of rows) expect(within(row).getAllByRole("link")).toHaveLength(1);
    });
  });

  /** Absence renders as absence: an empty shelf draws an empty list, never a placeholder row. */
  it("draws nothing at all for an empty shelf", async () => {
    await renderSurface(<ClubIndexGrid rows={[]} />, async () => {
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    });
  });
});

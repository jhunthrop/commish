import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { SEAT_HOLD_REFUSALS } from "@/matchmaking/seat-hold";
import { SeatTakenPanel } from "./seat-taken-panel";

describe("SeatTakenPanel", () => {
  it("says the seat is gone and nothing was charged, with two real actions, in both themes, axe-clean", async () => {
    await renderSurface(
      <SeatTakenPanel
        leagueName="Rookie Snake Room"
        primaryAction={<Link href="/browse?rung=open_12">Join the next open league</Link>}
        secondaryAction={<Link href="/browse">See leagues closest to filling</Link>}
      />,
      async ({ container }) => {
        expect(screen.getByText(SEAT_HOLD_REFUSALS.taken)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Join the next open league" })).toHaveAttribute("href", "/browse?rung=open_12");
        expect(screen.getByRole("link", { name: "See leagues closest to filling" })).toHaveAttribute("href", "/browse");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("never renders the same two actions twice — the caller decides them, this panel only lays them out", () => {
    render(
      <SeatTakenPanel
        leagueName="Friend's League"
        primaryAction={<Link href="/app/join/CODE2">The league that filled first</Link>}
        secondaryAction={<Link href="/browse">Browse open leagues</Link>}
      />,
    );
    expect(screen.getByRole("link", { name: "The league that filled first" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
  });
});

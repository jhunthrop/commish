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

  // Identity, proven on both the default reason and the explicit one — Task 20's invite landing
  // renders this exact component and asserts on this exact hook (F15).
  it("keeps its data-testid identity regardless of reason", () => {
    const { unmount } = render(
      <SeatTakenPanel leagueName="Rookie Snake Room" primaryAction={<Link href="/browse">Browse</Link>} secondaryAction={<Link href="/browse">Browse</Link>} />,
    );
    expect(screen.getByTestId("seat-taken-panel")).toBeInTheDocument();
    unmount();
    render(
      <SeatTakenPanel
        leagueName="Rookie Snake Room"
        reason="draft-started"
        primaryAction={<Link href="/browse">Browse</Link>}
        secondaryAction={<Link href="/browse">Browse</Link>}
      />,
    );
    expect(screen.getByTestId("seat-taken-panel")).toBeInTheDocument();
  });

  // Fix round 1 (review MEDIUM): the default reason's copy is unchanged from before this prop
  // existed — the shelf's own race-loss wording, verbatim.
  it("defaults to the seat-taken reason, unchanged copy", () => {
    render(
      <SeatTakenPanel leagueName="Rookie Snake Room" primaryAction={<Link href="/browse">Browse</Link>} secondaryAction={<Link href="/browse">Browse</Link>} />,
    );
    expect(screen.getByRole("heading", { name: "Rookie Snake Room filled up" })).toBeInTheDocument();
    expect(screen.getByText(SEAT_HOLD_REFUSALS.taken)).toBeInTheDocument();
  });

  // Fix round 1 (review MEDIUM): a started draft is never a seat-hold race on the invite path
  // (no hold is ever taken there) — this reason must say something true instead of borrowing the
  // shelf's race-loss sentence.
  it("says something true for a started draft, never the shelf's race-loss sentence", () => {
    render(
      <SeatTakenPanel
        leagueName="Rookie Snake Room"
        reason="draft-started"
        primaryAction={<Link href="/browse">Browse</Link>}
        secondaryAction={<Link href="/browse">Browse</Link>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Rookie Snake Room already started its draft" })).toBeInTheDocument();
    expect(
      screen.getByText("This league's roster filled and its draft is already underway. Browse open leagues to find one still taking players."),
    ).toBeInTheDocument();
    expect(screen.queryByText(SEAT_HOLD_REFUSALS.taken)).not.toBeInTheDocument();
  });
});

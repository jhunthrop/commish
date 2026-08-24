import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { ReleaseSeatControl } from "./release-seat-control";

describe("ReleaseSeatControl", () => {
  it("is a quiet text control at zero rolls, in both themes, axe-clean", async () => {
    await renderSurface(
      <ReleaseSeatControl leagueId="l1" leagueName="Half-PPR #241" kickoffRolls={0} />,
      async ({ container }) => {
        const trigger = screen.getByRole("button", { name: "Release your seat" });
        expect(trigger.tagName).toBe("BUTTON");
        expect(trigger.className).not.toMatch(/bg-negative|bg-accent/);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("takes a visible secondary Button from the first roll onward (F12), in both themes, axe-clean", async () => {
    await renderSurface(
      <ReleaseSeatControl leagueId="l1" leagueName="Half-PPR #241" kickoffRolls={1} />,
      async ({ container }) => {
        const trigger = screen.getByRole("button", { name: "Release your seat" });
        // `Button`'s own `secondary` variant class, `button.tsx`'s `VARIANT.secondary`.
        expect(trigger.className).toMatch(/border-line/);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("opens a destructive confirm Modal with the league's own consequence copy, and cancel closes it without releasing, in both themes, axe-clean", async () => {
    await renderSurface(
      <ReleaseSeatControl leagueId="l1" leagueName="Half-PPR #241" kickoffRolls={0} />,
      async ({ container }) => {
        fireEvent.click(screen.getByRole("button", { name: "Release your seat" }));
        const dialog = await screen.findByRole("dialog", { name: "Release your seat?" });
        expect(dialog).toHaveTextContent(
          "You will lose your seat in Half-PPR #241. Someone else can take it right away, and the league may fill without you.",
        );
        const confirmButton = screen.getByRole("button", { name: "Release seat" });
        expect(confirmButton.className).toMatch(/bg-negative/); // the destructive variant
        // P9 fix round, P8-L3: the escalated confirm dialog itself, not just the trigger.
        expect(await axe(container)).toHaveNoViolations();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      },
    );
  });

  it("releases the seat on confirm, calls DELETE and shows the release's own confirmation", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { released: true } });
    const onReleased = vi.fn();
    renderInLeague(
      <ReleaseSeatControl leagueId="l1" leagueName="Half-PPR #241" kickoffRolls={2} onReleased={onReleased} />,
      fixture.deps,
    );

    fireEvent.click(screen.getByRole("button", { name: "Release your seat" }));
    await screen.findByRole("dialog", { name: "Release your seat?" });
    fireEvent.click(screen.getByRole("button", { name: "Release seat" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fixture.calls).toEqual(["DELETE /api/leagues/l1/seat"]);
    expect(onReleased).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("You released your seat in Half-PPR #241. Someone else can take it now.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Release your seat" })).not.toBeInTheDocument();
  });

  it("shows the service's own refusal inline, and keeps the control available", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "This league's draft has already started, so there is no seat left to release." });
    renderInLeague(<ReleaseSeatControl leagueId="l1" leagueName="Half-PPR #241" kickoffRolls={0} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Release your seat" }));
    await screen.findByRole("dialog", { name: "Release your seat?" });
    fireEvent.click(screen.getByRole("button", { name: "Release seat" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This league's draft has already started, so there is no seat left to release.");
    expect(screen.getByRole("button", { name: "Release your seat" })).toBeInTheDocument();
  });

  it("closes on Escape, the same keyboard operability every Modal already guarantees", async () => {
    renderInLeague(<ReleaseSeatControl leagueId="l1" leagueName="Half-PPR #241" kickoffRolls={0} />, fixtureLeagueDeps().deps);
    fireEvent.click(screen.getByRole("button", { name: "Release your seat" }));
    const dialog = await screen.findByRole("dialog", { name: "Release your seat?" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

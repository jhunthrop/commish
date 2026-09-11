import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { DrawerState } from "../lib/drawer-state";
import { RoomDrawer } from "./room-drawer";

const at = (surface: DrawerState["surface"], height: DrawerState["height"]): DrawerState => ({
  surface,
  height,
  lastSurface: surface ?? "players",
});

const noop = () => undefined;

describe("RoomDrawer", () => {
  it("renders the four chips and no panel while collapsed", () => {
    render(
      <RoomDrawer keysShown={false} leagueId="l1" state={at(null, "chip")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    for (const label of ["Players", "Standings", "Trades", "Activity"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryByText("surface content")).toBeNull();
  });

  it("marks the open surface's chip expanded and shows the panel at half", () => {
    render(
      <RoomDrawer keysShown={false} leagueId="l1" state={at("standings", "half")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    expect(screen.getByRole("button", { name: "Standings" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("surface content")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Full height" })).toBeTruthy();
  });

  it("offers Back to room at full height, never Full height", () => {
    render(
      <RoomDrawer keysShown={false} leagueId="l1" state={at("players", "full")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    expect(screen.getByRole("button", { name: "Back to room" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Full height" })).toBeNull();
  });

  it("routes chip taps, expand and esc to the shell", () => {
    const onChipTap = vi.fn();
    const onExpand = vi.fn();
    const onEsc = vi.fn();
    render(
      <RoomDrawer keysShown={false} leagueId="l1" state={at("players", "half")} onChipTap={onChipTap} onExpand={onExpand} onEsc={onEsc}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trades" }));
    expect(onChipTap).toHaveBeenCalledWith("trades");
    fireEvent.click(screen.getByRole("button", { name: "Full height" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(onEsc).toHaveBeenCalledTimes(1);
  });

  it("projects the same surfaces as the phone tab bar, with the room first", () => {
    render(
      <RoomDrawer keysShown={false} leagueId="l1" state={at("players", "full")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    const nav = screen.getByRole("navigation", { name: "League room" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((link) => link.textContent)).toEqual(["Room", "Players", "Standings", "Trades", "Activity"]);
    expect(links[0]?.getAttribute("href")).toBe("/app/leagues/l1");
    expect(links[1]?.getAttribute("href")).toBe("/app/leagues/l1/players");
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
  });

  /**
   * M5: the chip row used to print "space opens the drawer · / searches players · esc collapses
   * everything" on every visit. That is an explainer under a control, which P7 does not allow.
   */
  it("shows no sentence about the shortcuts, ever", () => {
    render(
      <RoomDrawer keysShown leagueId="l1" state={at(null, "chip")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    expect(screen.queryByText(/opens the drawer/)).toBeNull();
    expect(screen.queryByText(/searches players/)).toBeNull();
    expect(screen.queryByText(/collapses everything/)).toBeNull();
  });

  it("keeps the keyboard glyphs off screen until somebody asks for them", () => {
    const { rerender } = render(
      <RoomDrawer keysShown={false} leagueId="l1" state={at(null, "chip")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    expect(screen.queryByTestId("keyboard-glyphs")).toBeNull();

    rerender(
      <RoomDrawer keysShown leagueId="l1" state={at(null, "chip")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
    );
    const glyphs = screen.getByTestId("keyboard-glyphs");
    // Glyphs beside the noun each key reaches — a legend, not a sentence.
    for (const key of ["space", "/", "esc"]) expect(glyphs).toHaveTextContent(key);
    for (const reaches of ["Drawer", "Players", "Room"]) expect(glyphs).toHaveTextContent(reaches);
  });

  it("has no axe violations in either theme", async () => {
    await renderSurface(
      <RoomDrawer keysShown={false} leagueId="l1" state={at("players", "half")} onChipTap={noop} onExpand={noop} onEsc={noop}>
        <p>surface content</p>
      </RoomDrawer>,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});

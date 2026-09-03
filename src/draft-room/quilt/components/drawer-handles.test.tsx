import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CollapseEvent, ExpandedSurface } from "../state/collapse";
import { DrawerHandles } from "./drawer-handles";

const COLLAPSED: ExpandedSurface = { kind: "none" };
const HALF: ExpandedSurface = { kind: "drawer", height: "half", tab: "pool" };
const FULL: ExpandedSurface = { kind: "drawer", height: "full", tab: "pool" };

function renderHandles(surface: ExpandedSurface, hasByes = true) {
  const dispatch = vi.fn<(event: CollapseEvent) => void>();
  render(<DrawerHandles surface={surface} dispatch={dispatch} hasByes={hasByes} />);
  return dispatch;
}

describe("DrawerHandles", () => {
  it("shows every tab handle and the grabber even collapsed — opening is never a mystery gesture", () => {
    renderHandles(COLLAPSED);
    for (const name of ["Pool", "My sheet", "Byes", "Picks"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByTestId("drawer-grabber")).toHaveTextContent(/drag or tap · space/i);
  });

  it("hides the Byes handle when the schedule has nothing to claim", () => {
    renderHandles(COLLAPSED, false);
    expect(screen.queryByRole("tab", { name: /Byes/ })).toBeNull();
  });

  it("collapsed, tapping any tab opens the drawer at half on that surface (SET_TAB)", () => {
    const dispatch = renderHandles(COLLAPSED);
    fireEvent.click(screen.getByRole("tab", { name: /Picks/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TAB", tab: "picks" });
  });

  it("open, tapping an INACTIVE tab switches surfaces without touching the height (SET_TAB)", () => {
    const dispatch = renderHandles(HALF);
    fireEvent.click(screen.getByRole("tab", { name: /My sheet/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_TAB", tab: "sheet" });
  });

  it("tapping the ACTIVE tab walks the drawer down — the collapse machine's own TOGGLE_DRAWER", () => {
    const atHalf = renderHandles(HALF);
    fireEvent.click(screen.getByRole("tab", { name: /Pool/ }));
    expect(atHalf).toHaveBeenCalledWith({ type: "TOGGLE_DRAWER" });
  });

  it("marks the active tab selected only while the drawer is open", () => {
    renderHandles(HALF);
    expect(screen.getByRole("tab", { name: /Pool/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Picks/ })).toHaveAttribute("aria-selected", "false");
  });

  it("flips the chevron with state: down on the open active tab, up on Pool while collapsed", () => {
    renderHandles(HALF);
    expect(screen.getByTestId("handle-chevron").className).not.toContain("rotate-180");
  });

  it("collapsed, the chevron rides the default Pool tab pointing up", () => {
    renderHandles(COLLAPSED);
    const chevron = screen.getByTestId("handle-chevron");
    expect(chevron.className).toContain("rotate-180");
    expect(screen.getByRole("tab", { name: /Pool/ })).toContainElement(chevron);
  });

  it("the grabber taps like space: TOGGLE_DRAWER", () => {
    const dispatch = renderHandles(COLLAPSED);
    fireEvent.click(screen.getByTestId("drawer-grabber"));
    expect(dispatch).toHaveBeenCalledWith({ type: "TOGGLE_DRAWER" });
  });

  it("dragging the grabber up raises one step: collapsed to half, half to full", () => {
    const fromCollapsed = renderHandles(COLLAPSED);
    const grabber = screen.getByTestId("drawer-grabber");
    fireEvent.pointerDown(grabber, { clientY: 500 });
    fireEvent.pointerUp(grabber, { clientY: 420 });
    expect(fromCollapsed).toHaveBeenCalledWith({ type: "SET_HEIGHT", height: "half" });
  });

  it("dragging up at half fills the stage; dragging down at full gives half back", () => {
    const atHalf = renderHandles(HALF);
    const grabber = screen.getByTestId("drawer-grabber");
    fireEvent.pointerDown(grabber, { clientY: 500 });
    fireEvent.pointerUp(grabber, { clientY: 420 });
    expect(atHalf).toHaveBeenCalledWith({ type: "SET_HEIGHT", height: "full" });
  });

  it("dragging down lowers one step, and a sub-threshold wiggle is just a tap", () => {
    const atFull = renderHandles(FULL);
    const grabber = screen.getByTestId("drawer-grabber");
    fireEvent.pointerDown(grabber, { clientY: 300 });
    fireEvent.pointerUp(grabber, { clientY: 380 });
    expect(atFull).toHaveBeenCalledWith({ type: "SET_HEIGHT", height: "half" });

    const atHalf = renderHandles(HALF);
    const halfGrabber = screen.getAllByTestId("drawer-grabber")[1]!;
    fireEvent.pointerDown(halfGrabber, { clientY: 300 });
    fireEvent.pointerUp(halfGrabber, { clientY: 380 });
    expect(atHalf).toHaveBeenCalledWith({ type: "COLLAPSE_ALL" });
  });

  it("a drag never double-fires the tap: the click after a handled drag is swallowed", () => {
    const dispatch = renderHandles(COLLAPSED);
    const grabber = screen.getByTestId("drawer-grabber");
    fireEvent.pointerDown(grabber, { clientY: 500 });
    fireEvent.pointerUp(grabber, { clientY: 420 });
    fireEvent.click(grabber);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_HEIGHT", height: "half" });
  });
});

import { describe, expect, it } from "vitest";
import { render, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { MockWireItem } from "@/mock-draft-service/wire";
import { MockWire } from "./mock-wire";

const MS_PER_MINUTE = 60_000;

const listItemTexts = (container: HTMLElement): readonly string[] =>
  within(container)
    .getAllByRole("listitem")
    .map((item) => item.textContent);

describe("MockWire", () => {
  it("renders nothing at all when there are no items — no band, no placeholder", () => {
    const { container } = render(<MockWire items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a single true item — the floor is one, not the front door's minItems of three", () => {
    const items: readonly MockWireItem[] = [
      { kind: "mocks_running", count: 1 },
    ];
    const { container } = render(<MockWire items={items} />);
    expect(listItemTexts(container)).toEqual(["1 mock drafting right now"]);
  });

  it("says each kind's own sentence in the coarse time family, actor-free", () => {
    const items: readonly MockWireItem[] = [
      { kind: "mocks_running", count: 3 },
      { kind: "mock_filled", teamCount: 12, agoMs: 4 * MS_PER_MINUTE },
    ];
    const { container } = render(<MockWire items={items} />);
    expect(listItemTexts(container)).toEqual([
      "3 mocks drafting right now",
      "A 12-team mock filled 4 minutes ago",
    ]);
  });

  it("pluralizes a single running mock correctly", () => {
    const items: readonly MockWireItem[] = [
      { kind: "mocks_running", count: 1 },
    ];
    const { getByText } = render(<MockWire items={items} />);
    expect(getByText("1 mock drafting right now")).toBeInTheDocument();
  });

  it("inks only the newest mock_filled item — older ones render plain", () => {
    const items: readonly MockWireItem[] = [
      { kind: "mock_filled", teamCount: 10, agoMs: MS_PER_MINUTE },
      { kind: "mock_filled", teamCount: 8, agoMs: 20 * MS_PER_MINUTE },
    ];
    const { container } = render(<MockWire items={items} />);
    const listItems = within(container).getAllByRole("listitem");
    expect(listItems[0]?.querySelector("b")).not.toBeNull();
    expect(listItems[1]?.querySelector("b")).toBeNull();
  });

  it("never scrolls — no marquee track, no duplicated accessible list (a lobby is not a marquee)", () => {
    const items: readonly MockWireItem[] = [
      { kind: "mocks_running", count: 2 },
    ];
    const { container, queryByTestId } = render(<MockWire items={items} />);
    expect(queryByTestId("wire-track")).not.toBeInTheDocument();
    expect(within(container).getAllByRole("list")).toHaveLength(1);
  });

  it("has one accessible list, labeled, never a live region", () => {
    const items: readonly MockWireItem[] = [
      { kind: "mocks_running", count: 2 },
    ];
    const { getByRole } = render(<MockWire items={items} />);
    const list = getByRole("list", { name: "Recent practice activity" });
    expect(list).not.toHaveAttribute("aria-live");
  });

  it("is axe-clean in both themes, populated", async () => {
    const items: readonly MockWireItem[] = [
      { kind: "mocks_running", count: 2 },
      { kind: "mock_filled", teamCount: 10, agoMs: 5 * MS_PER_MINUTE },
    ];
    await renderSurface(<MockWire items={items} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

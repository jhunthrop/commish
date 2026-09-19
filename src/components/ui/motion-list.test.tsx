import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { memo } from "react";
import { MOTION } from "@/design/motion";
import { MotionList, type MotionRowProps } from "./motion-list";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
  vi.restoreAllMocks();
});

interface Item {
  readonly id: string;
  readonly label: string;
}

let rowRenders = 0;
const Row = memo(function Row({ item, row }: { readonly item: Item; readonly row: MotionRowProps }) {
  rowRenders += 1;
  return (
    <li {...row} data-testid={`row-${item.id}`} className={`row ${row.className}`}>
      {item.label}
    </li>
  );
});

function List({ items }: { readonly items: readonly Item[] }) {
  return (
    <ol>
      <MotionList items={items} keyOf={(item) => item.id}>
        {(item, row) => <Row item={item} row={row} />}
      </MotionList>
    </ol>
  );
}

const A: Item = { id: "a", label: "Alpha" };
const B: Item = { id: "b", label: "Bravo" };
const C: Item = { id: "c", label: "Charlie" };

describe("MotionList", () => {
  it("animates nothing on its own mount: no row wears the entrance class", () => {
    render(<List items={[A, B]} />);
    expect(screen.getByTestId("row-a").className).not.toContain(MOTION.enter.className);
    expect(screen.getByTestId("row-b").className).toContain(MOTION.reorder.className);
  });

  it("a row that appears after mount fades in, and keeps its entrance through later re-renders", () => {
    const { rerender } = render(<List items={[A]} />);
    rerender(<List items={[A, B]} />);
    expect(screen.getByTestId("row-b").className).toContain(MOTION.enter.className);
    expect(screen.getByTestId("row-a").className).not.toContain(MOTION.enter.className);
    rerender(<List items={[A, B, C]} />);
    expect(screen.getByTestId("row-b").className).toContain(MOTION.enter.className);
  });

  it("a row that leaves is held in place as an inert ghost for the leave duration, then goes", () => {
    vi.useFakeTimers();
    const { rerender } = render(<List items={[A, B, C]} />);
    rerender(<List items={[A, C]} />);
    const ghost = screen.getByTestId("row-b");
    expect(ghost.className).toContain(MOTION.leave.className);
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost).toHaveAttribute("inert");
    // Still where it was: between Alpha and Charlie, never bumped to the end.
    expect(screen.getAllByRole("listitem", { hidden: true }).map((li) => li.textContent)).toEqual(["Alpha", "Bravo", "Charlie"]);
    act(() => {
      vi.advanceTimersByTime(MOTION.leave.durationMs + 1);
    });
    expect(screen.queryByTestId("row-b")).toBeNull();
  });

  it("with reduced motion a leaving row leaves at once and nothing slides", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    const { rerender } = render(<List items={[A, B]} />);
    rerender(<List items={[B]} />);
    expect(screen.queryByTestId("row-a")).toBeNull();
  });

  it("a row that changes place plays the FLIP difference back as a transform from where it was (layout offsets, never a rect that carries a transform in flight)", () => {
    const tops = new Map<string, number>([["a", 0], ["b", 40], ["c", 80]]);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return tops.get(this.getAttribute("data-motion-key") ?? "") ?? 0;
    });
    const { rerender } = render(<List items={[A, B, C]} />);
    tops.set("c", 0);
    tops.set("a", 40);
    tops.set("b", 80);
    rerender(<List items={[C, A, B]} />);
    // Charlie was at 80 and is now at 0: it starts 80px down and the class's transition carries it home.
    expect(screen.getByTestId("row-c").style.transform).toBe("translateY(80px)");
    expect(screen.getByTestId("row-a").style.transform).toBe("translateY(-40px)");
  });

  it("a leaving row is pinned out of the flow at its last offset, and the rows below slide up in the SAME frame it starts fading (item 5: the leave and the reorder never stack)", () => {
    const tops = new Map<string, number>([["a", 0], ["b", 40], ["c", 80]]);
    vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return tops.get(this.getAttribute("data-motion-key") ?? "") ?? 0;
    });
    const { rerender } = render(<List items={[A, B, C]} />);
    // Bravo leaves; out of the flow, Charlie is laid out at Bravo's old place at once.
    tops.set("c", 40);
    rerender(<List items={[A, C]} />);
    const ghost = screen.getByTestId("row-b");
    expect(ghost.className).toContain(MOTION.leave.className);
    expect(ghost.style.top).toBe("40px");
    expect(ghost.style.transform).toBe("");
    expect(screen.getByTestId("row-c").style.transform).toBe("translateY(40px)");
  });

  it("hands an unchanged row the same props object, so a memoized row does not re-render when a sibling leaves", () => {
    vi.useFakeTimers();
    const { rerender } = render(<List items={[A, B, C]} />);
    rowRenders = 0;
    rerender(<List items={[A, C]} />);
    // Only the ghost (its class changed) re-rendered; Alpha and Charlie kept their props.
    expect(rowRenders).toBe(1);
  });
});

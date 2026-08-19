import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { RoomLayout } from "./room-layout";

const slots = {
  rail: <header>Rail</header>,
  pool: <section aria-label="Pool">Pool</section>,
  stage: <section aria-label="Stage">Stage</section>,
  dock: <footer>Dock</footer>,
};

/** The layout wrapper each region sits in — where its scroll and ordering rules live. */
const bandFor = (text: string) => screen.getByText(text).closest("div")!;

describe("RoomLayout", () => {
  it("frames all four regions once, in both themes, axe-clean", async () => {
    await inBothThemes(<RoomLayout {...slots} />, async ({ container }) => {
      for (const text of ["Rail", "Pool", "Stage", "Dock"]) {
        expect(screen.getByText(text)).toBeInTheDocument();
      }
      expect(container.querySelectorAll("footer")).toHaveLength(1);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("is a full-height frame the page itself never scrolls", () => {
    render(<RoomLayout {...slots} />);
    const frame = screen.getByTestId("room-layout");
    expect(frame.className).toContain("lg:h-dvh");
    expect(frame.className).toContain("lg:overflow-hidden");
  });

  it("clips every band and delegates scrolling to the content that owns it", () => {
    render(<RoomLayout {...slots} />);
    // The pool column clips and lets `PlayerPool` scroll its own list; the stage clips too —
    // the board grid inside it is the ONE horizontal scroller (two nested auto containers
    // once rendered two stacked scrollbars).
    expect(bandFor("Pool").className).toContain("lg:overflow-hidden");
    expect(bandFor("Stage").className).toContain("lg:overflow-hidden");
    expect(bandFor("Stage").className).not.toContain("overflow-auto");
  });

  it("re-sequences the same four regions on a phone rather than rendering any of them twice", () => {
    render(<RoomLayout {...slots} />);
    // Dock above the board on a phone (`order-2`, sticky), back below it at `lg` (`lg:order-3`).
    expect(bandFor("Dock").className).toContain("order-2");
    expect(bandFor("Dock").className).toContain("lg:order-3");
    // Pool below the board on a phone, left of it at `lg`.
    expect(bandFor("Pool").className).toContain("order-2");
    expect(bandFor("Pool").className).toContain("lg:order-1");
    expect(bandFor("Stage").className).toContain("order-1");
    expect(bandFor("Stage").className).toContain("lg:order-2");
  });

  it("renders the aside band when one is given", () => {
    render(<RoomLayout rail={<p>rail</p>} pool={<p>pool</p>} stage={<p>stage</p>} dock={<p>dock</p>} aside={<p>aside</p>} />);
    expect(screen.getByText("aside")).toBeInTheDocument();
  });

  it("renders no aside band at all when none is given — the TV board has none", () => {
    render(<RoomLayout rail={<p>rail</p>} pool={<p>pool</p>} stage={<p>stage</p>} dock={<p>dock</p>} />);
    expect(screen.queryByTestId("room-aside")).not.toBeInTheDocument();
  });
});

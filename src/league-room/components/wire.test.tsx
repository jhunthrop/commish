import { describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { UI_CONFIG } from "@/components/ui/config";
import type { WireItem } from "@/matchmaking/contract";
import { Wire } from "./wire";

vi.mock("@/design/use-reduced-motion", () => ({ usePrefersReducedMotion: vi.fn(() => false) }));
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";

const MS_PER_MINUTE = 60_000;

/** One of each kind — the mock's own ticker variety, actor-free per S9. `draft_tonight` is
 *  retired (storefront review R1): a sit-and-go room has no chosen kickoff to announce. */
const ITEMS: readonly WireItem[] = [
  { kind: "seat_claimed", leagueName: "Sunday Money", agoMs: 5 * MS_PER_MINUTE, seatsOpen: 6 },
  { kind: "league_filled", leagueName: "Iron Bowl", draftStatus: "in_progress" },
  { kind: "season_count", count: 76 },
];

const listItemTexts = (container: HTMLElement): readonly string[] =>
  within(container).getAllByRole("listitem").map((item) => item.textContent);

describe("Wire", () => {
  it("renders nothing at all below UI_CONFIG.wire.minItems — a quiet product shows a clean hairline, never filler", () => {
    const { container } = render(<Wire items={ITEMS.slice(0, UI_CONFIG.wire.minItems - 1)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says each kind's own sentence, actor-free, with times in the coarse family", () => {
    const { container } = render(<Wire items={ITEMS} />);
    expect(listItemTexts(container)).toEqual([
      "A seat was claimed in Sunday Money · 5 minutes ago",
      "Iron Bowl filled · drafting now",
      "76 leagues filled this season",
    ]);
  });

  it("reads drafting soon for a filled league whose draft has not started, and under a minute ago for the freshest claim", () => {
    const { container } = render(
      <Wire
        items={[
          { kind: "seat_claimed", leagueName: "Sunday Money", agoMs: 30_000, seatsOpen: 6 },
          { kind: "league_filled", leagueName: "Iron Bowl", draftStatus: "scheduled" },
          { kind: "season_count", count: 76 },
        ]}
      />,
    );
    expect(listItemTexts(container)).toEqual([
      "A seat was claimed in Sunday Money · under a minute ago",
      "Iron Bowl filled · drafting soon",
      "76 leagues filled this season",
    ]);
  });

  it("tints league_filled money, an urgent seat count live, and leaves the rest quiet", () => {
    const urgent: WireItem = { kind: "seat_claimed", leagueName: "Almost Full", agoMs: MS_PER_MINUTE, seatsOpen: UI_CONFIG.seatMeter.lowSeatsThreshold - 1 };
    const justFilled: WireItem = { kind: "seat_claimed", leagueName: "Now Full", agoMs: MS_PER_MINUTE, seatsOpen: 0 };
    const { container } = render(<Wire items={[...ITEMS, urgent, justFilled]} />);
    const rows = within(container).getAllByRole("listitem");

    const byText = (text: string) => rows.find((row) => row.textContent?.includes(text));
    // v5: a filled room is a FACT (ink, semibold) — amber is furniture and the ticker IS
    // furniture; live-red survives for the genuinely urgent claim, in the role v5 split out.
    expect(byText("Iron Bowl filled")?.className).toContain("text-text-primary");
    expect(byText("Almost Full")?.className).toContain("text-live");
    // A quiet claim is muted ink, never the live family — and a claim that FILLED the league is
    // not urgent either (the league_filled item carries that fact, in money).
    expect(byText("Sunday Money")?.className).toContain("text-text-faint");
    expect(byText("Sunday Money")?.className).not.toContain("text-negative");
    expect(byText("Now Full")?.className).not.toContain("text-negative");
  });

  it("renders as the surface-inset mono band under the nav", () => {
    const { container } = render(<Wire items={ITEMS} />);
    const band = container.firstElementChild;
    expect(band?.className).toContain("bg-surface-inset");
    expect(band?.className).toContain("border-b");
    expect(band?.className).toContain("font-mono");
    expect(band?.className).toContain("text-xs");
  });

  it("duplicates the track content exactly once, duplicate aria-hidden, for the -50% CSS loop", () => {
    const { container, getByRole } = render(<Wire items={ITEMS} />);
    const track = container.querySelector('[data-testid="wire-track"]');
    expect(track?.className).toContain("animate-wire");
    expect(track?.children).toHaveLength(2);

    const [list, duplicate] = [...(track?.children ?? [])];
    expect(duplicate?.getAttribute("aria-hidden")).toBe("true");
    expect(duplicate?.textContent).toBe(list?.textContent);

    // The accessible form is the one static list — never two, never a live region.
    const accessible = getByRole("list", { name: "Recent activity" });
    expect(accessible).toBe(list);
    expect(within(accessible as HTMLElement).getAllByRole("listitem")).toHaveLength(ITEMS.length);
  });

  it("renders the first items as a static row under reduced motion — no scroll, no duplicate", () => {
    vi.mocked(usePrefersReducedMotion).mockReturnValue(true);
    try {
      const { container, getByRole } = render(<Wire items={ITEMS} />);
      expect(container.querySelector(".animate-wire")).toBeNull();
      expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
      const list = getByRole("list", { name: "Recent activity" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(UI_CONFIG.wire.minItems);
      expect(list.textContent).toContain("A seat was claimed in Sunday Money");
    } finally {
      vi.mocked(usePrefersReducedMotion).mockReturnValue(false);
    }
  });

  it("is axe-clean in both themes", async () => {
    await renderSurface(<Wire items={ITEMS} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});

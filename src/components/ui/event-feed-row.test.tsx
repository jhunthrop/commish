import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { EventFeedRow } from "./event-feed-row";
import { signedPoints } from "./number-format";
import type { StatComparison } from "./stat";

const SCORING_PLAYS: StatComparison = { percentile: 0.94, population: "scoring plays this week" };

describe("signedPoints", () => {
  it("always attaches a sign, which is the channel a colourblind reader actually has", () => {
    expect(signedPoints(6)).toBe("+6.0");
    expect(signedPoints(-2)).toBe("-2.0");
    expect(signedPoints(0)).toBe("+0.0");
  });

  it("never renders a negative zero, because nobody has ever scored one", () => {
    // The value is rounded BEFORE its sign is read: -0.04 displays as 0.0, so it must not
    // display as "-0.0".
    expect(signedPoints(-0.04)).toBe("+0.0");
    expect(signedPoints(-0.06)).toBe("-0.1");
  });

  it("takes its precision from the caller, because a delta and a season total round differently", () => {
    expect(signedPoints(6.25, 2)).toBe("+6.25");
    expect(signedPoints(6.25, 0)).toBe("+6");
  });
});

describe("EventFeedRow", () => {
  it("puts the clock, the description and the delta on one line", async () => {
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine>
        Bijan Robinson 12 yd rushing TD
      </EventFeedRow>,
      ({ getByText }) => {
        expect(getByText("8:42")).toBeInTheDocument();
        expect(getByText("Bijan Robinson 12 yd rushing TD")).toBeInTheDocument();
        expect(getByText("+6.0")).toBeInTheDocument();
      },
    );
  });

  it("keeps the sign on screen as text in every state", async () => {
    // The heartbeat's own colourblind gate. Whatever the tint is doing, "+" or "-" is text.
    for (const delta of ["+6.0", "-2.0"]) {
      await renderSurface(
        <EventFeedRow time="8:42" delta={delta} mine={false} comparison={SCORING_PLAYS}>
          A play
        </EventFeedRow>,
        ({ getByText }) => {
          expect(getByText(delta)).toBeInTheDocument();
        },
      );
    }
  });

  it("renders the delta through Stat, tinted only when a population was named", async () => {
    // ONE code path, not two: a `Stat` with no comparison IS plain ink (`neutral` is
    // `textPrimary`, no caret, no weight step), so a compared row and an uncompared row are
    // typographically identical apart from the tint the comparison earned.
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine={false}>
        A play
      </EventFeedRow>,
      ({ container }) => {
        const stat = container.querySelector("[data-magnitude]")!;
        expect(stat.getAttribute("data-magnitude")).toBe("neutral");
        expect(stat.textContent).not.toContain("▲");
        expect(container.textContent).not.toContain("scoring plays this week");
      },
    );
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine={false} comparison={SCORING_PLAYS}>
        A play
      </EventFeedRow>,
      ({ container, getByText }) => {
        const stat = container.querySelector("[data-magnitude]")!;
        expect(stat.getAttribute("data-magnitude")).toBe("strong");
        expect(stat.textContent).toContain("▲");
        expect(getByText("Top 6% of scoring plays this week.")).toBeInTheDocument();
      },
    );
  });

  it("turns the delta on its side, because a feed row is a single line", async () => {
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine={false} comparison={SCORING_PLAYS}>
        A play
      </EventFeedRow>,
      ({ container }) => {
        const stat = container.querySelector("[data-magnitude]")!;
        expect(stat.tagName).toBe("SPAN");
        expect(stat.className).toContain("inline-flex");
      },
    );
  });

  it("distinguishes my own row in two channels, neither of them a hue", async () => {
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine>
        A play
      </EventFeedRow>,
      ({ container }) => {
        const row = container.querySelector("[data-mine]")!;
        expect(row.getAttribute("data-mine")).toBe("true");
        expect(row.className).toContain("border-edge");
        expect(row.className).toContain("bg-surface-raised");
      },
    );
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine={false}>
        A play
      </EventFeedRow>,
      ({ container }) => {
        const row = container.querySelector("[data-mine]")!;
        expect(row.getAttribute("data-mine")).toBe("false");
        // The same 2px rule on both, so the description column starts at the same x on every
        // row — a feed whose rows do not line up cannot be scanned at all.
        expect(row.className).toContain("border-l-2");
        expect(row.className).toContain("border-transparent");
      },
    );
  });

  it("truncates the description and nothing else, because a clipped number is a wrong number", async () => {
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine={false}>
        A very long play description that will not fit in the row at any width
      </EventFeedRow>,
      ({ getByText, container }) => {
        const description = getByText(/A very long play description/);
        expect(description.className).toContain("truncate");
        expect(description.className).toContain("min-w-0");
        expect(getByText("8:42").className).toContain("shrink-0");
        expect(container.querySelector("[data-magnitude]")!.className).toContain("shrink-0");
      },
    );
  });

  it("is axe-clean in both themes, compared and uncompared", async () => {
    await renderSurface(
      <EventFeedRow time="8:42" delta="+6.0" mine comparison={SCORING_PLAYS}>
        Bijan Robinson 12 yd rushing TD
      </EventFeedRow>,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    await renderSurface(
      <EventFeedRow time="8:42" delta="-2.0" mine={false}>
        Interception
      </EventFeedRow>,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});

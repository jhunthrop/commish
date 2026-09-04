import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  AuctionGlyph,
  ByeWeekGlyph,
  DraftPickGlyph,
  LineupGlyph,
  MatchupGlyph,
  PayoutGlyph,
  PlayoffsGlyph,
  SnakeOrderGlyph,
  TradeGlyph,
  WaiverGlyph,
} from "./glyphs";

const GLYPHS = {
  "draft-pick": DraftPickGlyph,
  "snake-order": SnakeOrderGlyph,
  auction: AuctionGlyph,
  waiver: WaiverGlyph,
  trade: TradeGlyph,
  "bye-week": ByeWeekGlyph,
  lineup: LineupGlyph,
  matchup: MatchupGlyph,
  playoffs: PlayoffsGlyph,
  payout: PayoutGlyph,
} as const;

describe("the ten fantasy glyphs", () => {
  it.each(Object.entries(GLYPHS))("%s renders a 24x24 svg on the shared shape", (_name, Glyph) => {
    const { container } = render(<Glyph />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke", "currentColor");
  });

  it("forwards caller props (width, height, className, aria) the same way Icon invokes them", () => {
    const { container } = render(<TradeGlyph width={18} height={18} className="text-text-muted" aria-hidden="true" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "18");
    expect(svg).toHaveAttribute("height", "18");
    expect(svg).toHaveAttribute("class", "text-text-muted");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

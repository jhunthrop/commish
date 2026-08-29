import type { ReactElement } from "react";

export interface MovementProps {
  /** Places gained since the previous ranking. Negative is a fall, zero is unchanged. */
  readonly places: number;
  /** What the previous ranking was, for the screen reader. "the market", "last week". */
  readonly against: string;
}

/**
 * SUNDAY v5, LAW 2 — movement is a story; position is only a state.
 *
 * `3` tells you where a player sits. `▲ 9` tells you what happened, and it is the timing tower's
 * oldest trick: one narrow column turns a table into a narrative. This is the whole component.
 *
 * THE ARROW IS NOT THE SIGNAL, the colour and the number are — the glyph is there so the meaning
 * survives a monochrome print and a screen reader gets a word rather than a triangle. `aria-hidden`
 * on the glyph, a real sentence in the label.
 *
 * Colour follows law 4's verdict pair: `positive` (cyan) for a rise, `negative` (warm red) for a
 * fall. Deliberately NOT green-versus-red — see the tokens' own docblock for why that pair is the
 * worst available one for an audience that is overwhelmingly men.
 *
 * A zero renders as an em rule in faint ink and carries no chroma at all, because "unchanged" is a
 * fact rather than a verdict, and law 1 says facts are grey.
 */
export function Movement({ places, against }: MovementProps): ReactElement {
  if (places === 0) {
    return (
      <span className="font-display text-xs text-text-faint">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Unchanged against {against}</span>
      </span>
    );
  }

  const risen = places > 0;
  const magnitude = Math.abs(places);

  return (
    <span
      className={`font-display text-xs font-bold whitespace-nowrap ${risen ? "text-positive" : "text-negative"}`}
      data-movement={risen ? "up" : "down"}
    >
      <span aria-hidden="true">
        {risen ? "▲" : "▼"} {magnitude}
      </span>
      <span className="sr-only">
        {magnitude} {magnitude === 1 ? "place" : "places"} {risen ? "higher" : "lower"} than {against}
      </span>
    </span>
  );
}

"use client";

import type { ReactNode } from "react";
import { UI_CONFIG } from "@/components/ui/config";
import { formatCoarseDuration } from "@/components/ui/countdown";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import type { WireItem } from "@/matchmaking/contract";

/**
 * The mock's `.wire b`: the one fact in an otherwise quiet sentence, in ink at 600. (The
 * practice lobby's own sibling ticker, `MockWire`, shared this idiom until the mock-drafts
 * workflow pass retired that surface, 2026-09-03.)
 */
export function Ink({ children }: { readonly children: ReactNode }) {
  return <b className="font-semibold text-text-primary">{children}</b>;
}

/**
 * Which of the three wire voices an item speaks in — the mock's `.up` (money) and `.hot` (live)
 * against the quiet default. `league_filled` is the money moment (a room got to capacity — one
 * of the two things green is allowed to mean). A `seat_claimed` item goes live exactly when the
 * claim left the league URGENTLY short of seats — the SAME `UI_CONFIG.seatMeter.lowSeatsThreshold`
 * every seat sentence keys on, so "urgent" means one thing product-wide — and `> 0` for the same
 * reason `seatSentence`'s clause holds it: a claim that FILLED the league is the `league_filled`
 * item's fact, in money, not an emergency.
 */
function toneOf(item: WireItem): "quiet" | "money" | "live" {
  if (item.kind === "league_filled") return "money";
  if (
    item.kind === "seat_claimed" &&
    item.seatsOpen > 0 &&
    item.seatsOpen < UI_CONFIG.seatMeter.lowSeatsThreshold
  )
    return "live";
  return "quiet";
}

/**
 * SUNDAY v5: the ticker is furniture, so it does not wear the furniture colour — amber on every
 * second item was the loudest thing on the storefront. A filled room is a FACT now (money green
 * is gone and a fact wears ink, law 1); the live channel survives for the one thing that is
 * genuinely urgent, in the `live` role v5 split from `negative`.
 */
export const TONE_CLASS: Readonly<Record<ReturnType<typeof toneOf>, string>> = {
  quiet: "text-text-faint",
  money: "font-semibold text-text-primary",
  live: "font-semibold text-live",
};

/**
 * The band's own shell classes: a hairline-bottomed, inset strip in the wire's own mono/xs
 * register. `overflow-hidden` + `whitespace-nowrap` carry this component's scrolling marquee.
 */
export const WIRE_BAND_CLASSNAME =
  "overflow-hidden whitespace-nowrap border-b border-line bg-surface-inset py-1.5 font-mono text-xs";

/**
 * One item's sentence — every kind's copy lives here, actor-free (S9: no member name, ever, on
 * an anonymous surface), times always through the coarse `formatCoarseDuration` family. A
 * money- or live-toned item speaks whole-sentence in its tint (the mock's `.up`/`.hot` spans);
 * a quiet one carries its one fact in `Ink`.
 */
function sentenceOf(
  item: WireItem,
  tone: "quiet" | "money" | "live",
): ReactNode {
  switch (item.kind) {
    case "seat_claimed": {
      const league =
        tone === "quiet" ? <Ink>{item.leagueName}</Ink> : item.leagueName;
      return (
        <>
          A seat was claimed in {league} · {formatCoarseDuration(item.agoMs)}{" "}
          ago
        </>
      );
    }
    case "league_filled":
      return (
        <>
          {item.leagueName} filled · drafting{" "}
          {item.draftStatus === "in_progress" ? "now" : "soon"}
        </>
      );
    case "season_count":
      return (
        <>
          <Ink>{item.count}</Ink> leagues filled this season
        </>
      );
  }
}

function WireList({
  items,
  hidden,
}: {
  readonly items: readonly WireItem[];
  readonly hidden?: boolean;
}) {
  return (
    <ul
      role={hidden === true ? undefined : "list"}
      aria-hidden={hidden === true ? "true" : undefined}
      aria-label={hidden === true ? undefined : "Recent activity"}
      className="inline"
    >
      {items.map((item, index) => {
        const tone = toneOf(item);
        return (
          <li
            key={index}
            className={`mx-6 inline whitespace-nowrap ${TONE_CLASS[tone]}`}
          >
            {/* The broadcast tick: a breathing dot on the genuinely urgent item only — the same
                pulse the live chip carries, because they are reporting the same fact. */}
            {tone === "live" ? (
              <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-pill bg-live align-middle motion-safe:animate-pulse-live" />
            ) : null}
            {sentenceOf(item, tone)}
          </li>
        );
      })}
    </ul>
  );
}

export interface WireProps {
  readonly items: readonly WireItem[];
}

/**
 * THE WIRE (Phase 3.7, Task 8) — real product events streaming under the public nav the way a
 * ticker runs under a broadcast, the Sunday Standard's signature element (rule 6: only true
 * things move, and every item here is something that actually happened).
 *
 * REQUEST-TIME TRUTH WITH COARSE TIMESTAMPS. The items are one `listWireItems`
 * (`@/league-service/wire`) read at render time on a `force-dynamic` page; the scrolling is CSS
 * (`animate-wire`), never a socket — there is no anonymous SSE fan-out for signed-out visitors
 * (deferral D4), and the coarse "5 minutes ago" register is what keeps a request-time sentence
 * honest for the whole life of the page, the same reasoning `seatCountsAsOfSentence`
 * (`./public-league-list`) words for the shelf.
 *
 * The track holds the item list TWICE — the `-50%` keyframe loop needs identical halves to
 * cycle seamlessly (Task 2's carry, `globals.css`'s own `commish-wire` comment) — with the
 * duplicate `aria-hidden`: the accessible form is the one static `role="list"` ("Recent
 * activity"), never a live region (the content does not change after render) and never twice.
 * Reduced motion is a real branch, not a frozen marquee: the first `UI_CONFIG.wire.minItems`
 * items render as a static row, nothing scrolls, nothing is duplicated.
 *
 * Fewer than `UI_CONFIG.wire.minItems` real items renders NOTHING — a quiet product shows a
 * clean hairline, never filler (no mock data on a real surface, ever).
 */
export function Wire({ items }: WireProps) {
  const reducedMotion = usePrefersReducedMotion();
  if (items.length < UI_CONFIG.wire.minItems) return null;

  return (
    <div className={`relative ${WIRE_BAND_CLASSNAME}`}>
      {reducedMotion ? (
        <WireList items={items.slice(0, UI_CONFIG.wire.minItems)} />
      ) : (
        <div data-testid="wire-track" className="inline-block animate-wire">
          <WireList items={items} />
          <WireList items={items} hidden />
        </div>
      )}
      {/* Broadcast edge fades: the marquee's entry and exit dissolve into the band instead of
          hard-clipping mid-word at the viewport edge, which read as a rendering fault. Painted
          from the band's own ground so both themes hold; aria-hidden, pure chrome. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-surface-inset via-surface-inset/70 to-transparent" />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-surface-inset via-surface-inset/70 to-transparent" />
    </div>
  );
}

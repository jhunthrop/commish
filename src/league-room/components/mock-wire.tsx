import type { ReactNode } from "react";
import { formatCoarseDuration } from "@/components/ui/countdown";
import { plural } from "@/domain/duration";
import type { MockWireItem } from "@/mock-draft-service/wire";
import { Ink, TONE_CLASS, WIRE_BAND_CLASSNAME } from "./wire";

/**
 * R3 (the lobby design review's carry, gate: "Where is the Sunday Standard's signature?") — the
 * practice lobby's OWN wire, a deliberate SIBLING of the front door's `Wire` (`./wire`), never an
 * extension of its `WireItem` union: that contract already names a specific real-league
 * disclosure surface (`ENFORCED_LEAGUE_SQL`'s own public-only join, `@/matchmaking/contract`'s
 * own docblock), and a mock room's vocabulary — no money, no seats, no league name at all — would
 * pollute a matchmaking type with a lane it has nothing to do with. What IS shared, verbatim, is
 * the presentational shell `Wire` already built: `Ink` (the one-fact emphasis), `TONE_CLASS`
 * (quiet/live's exact colors) and `WIRE_BAND_CLASSNAME` (the hairline-bottomed inset strip) are
 * all imported from `./wire`, never respelled — DRY on the visuals, separate on the words.
 *
 * THREE DELIBERATE DEVIATIONS FROM `Wire`'S OWN CONTRACT, each because this surface is a
 * different shape than the front door's:
 *
 *  1. **No scroll, ever** (RULED — no `animate-wire` here). The front door's ticker loops a
 *     twelve-item marquee under an anonymous public nav; this is a signed-in practice lobby, not
 *     a broadcast — "a lobby is not a marquee." The band is ONE static line, newest-first,
 *     truncating via plain CSS (`truncate`) rather than wrapping or scrolling past.
 *  2. **Real-or-nothing at ONE item, not `UI_CONFIG.wire.minItems` (3).** `Wire` needs three
 *     items before a non-scrolling reduced-motion row reads as "activity" rather than "two lonely
 *     sentences"; this band never scrolls in the first place, so that reasoning does not carry
 *     over — a single true fact ("3 mocks drafting right now") is exactly as honest sitting alone
 *     as it would be beside three others, and holding it back would only make an active lobby
 *     look quieter than it is.
 *  3. **Two item kinds, not three.** `seat_taken` (a claim on an open lobby room) was in this
 *     surface's original vocabulary and was deliberately never built — see `MockWireItem`'s own
 *     docblock (`@/mock-draft-service/wire`) for why the data does not exist to say it honestly.
 *
 * Accessibility mirrors `Wire`'s own static form exactly: `role="list"`, one `aria-label`, never
 * a live region — the poll that refreshes this band's items re-renders the DOM like any other
 * data update, it does not announce itself, the identical choice `Wire`'s own docblock argues.
 */
export interface MockWireProps {
  readonly items: readonly MockWireItem[];
}

type MockWireTone = "quiet" | "live";

/** `mocks_running` is the one genuinely live fact this domain owns — the SAME red family
 *  `Wire`'s own `toneOf` reserves for a claim that left a league urgently short of seats.
 *  `mock_filled` stays quiet: a mock room holds no money, so it never reaches for the accent
 *  green `Wire` spends on `league_filled` (rule 1 — green means a filled OR a money moment, and
 *  a practice room is neither). */
function toneOf(item: MockWireItem): MockWireTone {
  return item.kind === "mocks_running" ? "live" : "quiet";
}

/**
 * One item's sentence, actor-free by construction (this domain names no member, ever — a mock
 * room's own vocabulary has no field to leak one from) and coarse-timed via `formatCoarseDuration`
 * — never an instant. Only the newest `mock_filled` item (`isNewest`) carries `Ink` on its one
 * fact, the elapsed time — every OLDER quiet item renders plain: a static, always-visible line is
 * a poor place to ink every entry the way the scrolling front door safely can, so only the
 * newest earns the pop, the single cue this band spends letting a reader tell "just happened"
 * from "a while ago" at a glance.
 */
function sentenceOf(item: MockWireItem, isNewest: boolean): ReactNode {
  switch (item.kind) {
    case "mocks_running":
      return <>{plural(item.count, "mock")} drafting right now</>;
    case "mock_filled": {
      const ago = <>{formatCoarseDuration(item.agoMs)} ago</>;
      return (
        <>
          A {item.teamCount}-team mock filled{" "}
          {isNewest ? <Ink>{ago}</Ink> : ago}
        </>
      );
    }
  }
}

/**
 * THE PRACTICE WIRE. Renders NOTHING at all when `items` is empty — no band, no placeholder, the
 * identical real-or-nothing law `Wire` keeps (deviation 2 above: this band's own floor is one
 * item, not three). One static, truncating line — never a marquee (deviation 1) — newest-first,
 * the same order `listMockWireItems` (`@/mock-draft-service/wire`) already hands down.
 */
export function MockWire({ items }: MockWireProps) {
  if (items.length === 0) return null;
  // Only a `mock_filled` item at index 0 counts as "the newest" for Ink purposes — `mocks_running`
  // always leads the list (it has no age) but is never itself Ink-eligible, so the newest FILL is
  // whichever `mock_filled` item appears first among the ones that follow it.
  const newestFilledIndex = items.findIndex(
    (item) => item.kind === "mock_filled",
  );

  return (
    <div className={WIRE_BAND_CLASSNAME}>
      <ul aria-label="Recent practice activity" className="truncate">
        {items.map((item, index) => {
          const tone = toneOf(item);
          return (
            <li
              key={index}
              className={`mx-6 inline whitespace-nowrap first:ms-0 ${TONE_CLASS[tone]}`}
            >
              {sentenceOf(item, index === newestFilledIndex)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

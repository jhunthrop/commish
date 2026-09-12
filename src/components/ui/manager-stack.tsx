import { Avatar } from "./avatar";

export interface StackedManager {
  readonly name: string;
  readonly avatar?: string | null;
  /** True for the reader's own seat — the amber ring, the one thing that says "yours". */
  readonly isSelf?: boolean;
}

export interface ManagerStackProps {
  /** The people, in seating order. Never a synthesized entry: a seat with nobody in it is
   *  `openSeats`, never a face with an invented name. */
  readonly people: readonly StackedManager[];
  /** How many faces before the overflow chip. @default 4 */
  readonly max?: number;
  /**
   * SEATS NOBODY IS IN YET, drawn as hollow rings after the faces (fix round 2, the founder's
   * screenshot: a room filling at 1 of 12 drew one face and nothing else, so the stack said
   * "somebody is here" and never "and there is room"). At most `OPEN_SEATS_SHOWN` rings, whatever
   * the number — a row of twelve dashed circles is a capacity diagram, and `SeatMeter` beneath
   * the stack is already the product's one seat figure. The overflow chip counts whatever the
   * faces and the rings together did not show, so the stack's arithmetic always adds up.
   *
   * A hollow ring is an ABSENCE drawn as an absence: never a face with an invented name in it,
   * which is the placeholder-dressed-as-data the refusal list rules out.
   */
  readonly openSeats?: number;
  /**
   * THE SENTENCE BESIDE THE FACES, and the reason this is not a bare row of avatars: P1 says a
   * face never stands alone, so the stack states who it is showing. The caller composes it,
   * because only the caller knows whether it is "Dana, Rey and 8 more are in" or "3 of 12
   * seated" — but it is required, so a stack of anonymous circles cannot be built.
   */
  readonly caption: string;
  readonly className?: string;
}

/**
 * THE MANAGER STACK (SIDELINE, 2026-09-10): overlapping faces of the people who are actually in
 * a room, with one sentence naming them. The mock's lobby row draws this shape; on a signed-out
 * surface the product may not name the people in a league it is advertising
 * (`PublicLeagueSummary`'s privacy boundary, and `SeatStack`'s own docblock), so this renders
 * only where membership is already visible to the reader. Its one consumer today is
 * `waiting-room.tsx`, on both of that room's heroes.
 *
 * The faces are `aria-hidden` and the caption carries the whole announcement: an overlapping
 * stack read one avatar at a time is four unlabelled images, and the sentence is what a screen
 * reader needs. The overflow chip counts REAL further people and never appears at zero.
 *
 * ONE SIZE, `lg` (40px) — Sideline's own "a stack of faces on a card" step (`AvatarSize`'s
 * docblock). No prop for it: the overflow chip has to match the faces it follows, and a size
 * prop is the seam where those two drift apart.
 */
/** At most three hollow rings, whatever the room's real gap. See `openSeats`. */
const OPEN_SEATS_SHOWN = 3;

export function ManagerStack({ people, max = 4, caption, openSeats = 0, className = "" }: ManagerStackProps) {
  const shown = people.slice(0, max);
  const rings = Math.max(0, Math.min(openSeats, OPEN_SEATS_SHOWN));
  // Everything the stack did NOT draw, people and empty seats alike, counted once.
  const overflow = people.length - shown.length + (openSeats - rings);
  const anything = shown.length > 0 || rings > 0;
  return (
    <span data-testid="manager-stack" className={`flex min-w-0 items-center gap-3 ${className}`.trimEnd()}>
      {!anything ? null : (
        <span className="flex shrink-0" aria-hidden="true">
          {shown.map((person, index) => (
            <Avatar
              key={`${person.name}-${index}`}
              name={person.name}
              avatar={person.avatar}
              size="lg"
              ring={person.isSelf === true ? "self" : undefined}
              // Your own face keeps the amber ring; everyone else's takes the paper ring that
              // separates one overlapping circle from the next. Never both: two ring utilities
              // on one element resolve by stylesheet order, and the loser would be silent.
              className={`${index === 0 ? "" : "-ml-2.5 "}${person.isSelf === true ? "" : "ring-2 ring-surface-elevated"}`.trimEnd()}
            />
          ))}
          {Array.from({ length: rings }, (_, index) => (
            // A dashed well, the same shape the approved mock draws: the size of a face, in the
            // place a face would be, visibly empty.
            <span
              key={`open-${index}`}
              data-testid="open-seat"
              className={`inline-flex size-10 shrink-0 rounded-pill border border-dashed border-edge ring-2 ring-surface-elevated ${
                shown.length === 0 && index === 0 ? "" : "-ml-2.5"
              }`.trimEnd()}
            />
          ))}
          {overflow > 0 ? (
            <span className="-ml-2.5 inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface-inset font-display text-sm font-bold text-text-muted ring-2 ring-surface-elevated">
              {`+${overflow}`}
            </span>
          ) : null}
        </span>
      )}
      <span className="min-w-0 truncate text-sm text-text-muted">{caption}</span>
    </span>
  );
}

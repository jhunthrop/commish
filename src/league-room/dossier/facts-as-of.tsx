import { MICRO_LABEL } from "@/components/ui/config";

/**
 * The reader's OWN clock, on purpose, and formatted here rather than through `@/league`'s
 * `formatAbsoluteTime`: room code may not import server modules as values (the boundary rule this
 * directory is under), and a stamp printed in UTC would make a manager in a September evening do
 * time-zone arithmetic to learn whether "as of" means an hour ago or yesterday. Module-level, the
 * same shape `waiting-room.tsx` uses, so a formatter is built once rather than on every render.
 */
const STAMP_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * WHEN THIS CARD'S FACTS WERE KNOWABLE (peek document design §3.6, 2026-09-07).
 *
 * Everything above this line but two things comes out of one stored document, built at a stated
 * moment and rebuilt when its inputs move. Printing that moment is what keeps the card from
 * implying every number on it is live: a designation captured an hour ago and a chart built after
 * last week's finalize are both honest, and both are things a manager is entitled to see the age of.
 *
 * THE TWO THINGS THIS LINE DOES NOT COVER, and it says so rather than overclaiming: the roster
 * holder and whether the room is a mock are joined on every read, so they are newer than this stamp
 * by construction.
 *
 * ABSENT MEANS ABSENT. A body assembled by a fixture or by an older reader carries no stamp, and
 * this renders nothing at all rather than inventing "now".
 */
export function FactsAsOf({ asOf }: { readonly asOf?: string }) {
  if (asOf === undefined) return null;
  return (
    <p className={`${MICRO_LABEL} text-text-muted`}>
      Facts as of {STAMP_FORMAT.format(new Date(asOf))}. Roster status is live.
    </p>
  );
}

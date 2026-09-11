import Link from "next/link";
import { Card, PlayerFace } from "@/components/ui";
import type { Player } from "@/domain/player";
import type { ClubIndexRow } from "../club-index";

/**
 * A club as the same object the club's own page draws (law 3, and the founder's centralization
 * rule): `PlayerFace` with the club standing in as a `DEF` whose `nflTeam` is its own code, which
 * is exactly the construction `TeamHeader` uses for the crest at the top of `/app/teams/[code]`.
 * The club's colour ring and initials therefore come from ONE rule in the product, not from a
 * second one invented here for a smaller tile.
 */
function clubAsFace(row: ClubIndexRow): Player {
  return { id: row.code, name: `${row.city} ${row.nickname}`, position: "DEF", nflTeam: row.code, headshotUrl: null, adp: null };
}

/**
 * THE SHELF OF 32 CLUBS — the index `/app/teams` serves, and the landing spot every `teamPagePath`
 * link in the product already implied. Each row is one whole link (the card is not the control,
 * the link inside it is), the crest leads, the city sits over the nickname the way the club's own
 * header sets them, and the code rides the mono line.
 *
 * No figure is quoted here on purpose: a record or a win total belongs beside its basis, and the
 * basis is a season the club's own page states. A shelf of 32 numbers with no basis in view is
 * exactly the "spreadsheet, not a timing tower" this design bans, so the shelf carries identity
 * only and the page carries the figures.
 */
export function ClubIndexGrid({ rows }: { readonly rows: readonly ClubIndexRow[] }) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <Card key={row.code} as="li" interactive padding="compact">
          <Link href={row.href} className="flex min-w-0 items-center gap-3 rounded-lg p-1.5">
            <PlayerFace player={clubAsFace(row)} size="md" />
            <span className="flex min-w-0 flex-col">
              <span className="text-xs leading-tight text-text-muted">{row.city}</span>
              <span className="truncate font-display font-semibold leading-tight text-text-primary">{row.nickname}</span>
            </span>
            <span className="ml-auto shrink-0 font-mono text-xs text-text-muted">{row.code}</span>
          </Link>
        </Card>
      ))}
    </ul>
  );
}

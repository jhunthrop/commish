import type { Player } from "@/domain/player";
import { PlayerFace } from "./player-face";
import { PositionBadge } from "./position-badge";

/**
 * A name in two ranks: the given name and everything after it.
 *
 * FIRST WORD, NOT LAST. The obvious split — last word is the surname — is wrong on this league's
 * own roster: "Amon-Ra St. Brown" surnames as "St. Brown" and "Marvin Harrison Jr." as
 * "Harrison Jr.", and both lose their second half to a `split` that keeps only the final token.
 * Taking the FIRST word as the given name and the remainder as the family name is right for every
 * shape a football roster actually carries, including the suffixes.
 *
 * A single-token name (a team defense, a player the feed carries mononymously) returns `null` for
 * the given name, and the object below prints one line rather than an empty one.
 */
export function splitName(name: string): { readonly given: string | null; readonly family: string } {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length <= 1) return { given: null, family: name.trim() };
  return { given: words[0]!, family: words.slice(1).join(" ") };
}

export interface PlayerObjectProps {
  readonly player: Player;
  readonly className?: string;
}

/**
 * A player at the size of his own screen — law 3 ("a player is an object") taken to the one
 * surface where the player IS the subject rather than a row in somebody's list.
 *
 * THREE PARTS AND NO FOURTH: the face on the club's colour, the name in two ranks, and the facts
 * as chips. There is no prose here and there is no room for any — the reference product's player
 * panel carries a position, a club and an age as three chips and not one sentence, and that is
 * most of why a denser screen than ours reads calmer than ours.
 *
 * THE NAME IS SPLIT BY TYPE, NOT BY PIGMENT, and this is the one place we deliberately diverge
 * from the reference. Theirs prints the given name in white and the surname in the club's own
 * colour. We cannot: rule 1's team-identity amendment (`docs/design-system.md`, "The fun-pass
 * amendments") reads *"A team's own colour, behind a player's face only. Never on a surface,
 * never behind text"*, and `TOKENS.team`'s own docblock adds that these thirty-two values are
 * "not a semantic role" and never become text. That is not pedantry about a rule: those pigments
 * are the clubs' real colours, no contrast gate has ever been run on them, and half of them —
 * the Steelers' black, the Saints' gold — are illegible as text in one theme or the other. So the
 * split is carried by SIZE and INK instead, the way a team sheet has always carried it: a quiet
 * given name over a display-scale surname. It survives both themes, every club, and a monochrome
 * eye, which the coloured version does not.
 *
 * IT RENDERS THE PAGE'S `<h1>` ITSELF. This is the player's own screen and the name is its
 * subject, so the alternative is a `PageTitle` printing "Ja'Marr Chase" at `display-md` directly
 * above this component printing it at `display-lg` — the same fact twice, in two sizes, which is
 * the redundancy this whole pass exists to remove. One call site, stated in this docblock: a
 * surface that wants a player object BESIDE other content wants `PlayerRow`, not this.
 *
 * WHERE THE AGE CHIP IS. The reference's third chip is the player's age; the domain `Player`
 * carries no birth date and the feed we map does not either (`src/stats/tank01/map.ts`), so this
 * renders two chips rather than inventing a third. The same ruling `PlayerFace` already makes
 * about the jersey number, for the same reason.
 */
export function PlayerObject({ player, className = "" }: PlayerObjectProps) {
  const { given, family } = splitName(player.name);
  return (
    <div className={`flex items-center gap-4 sm:gap-5 ${className}`}>
      <PlayerFace player={player} size="xl" />
      <div className="flex min-w-0 flex-col gap-1">
        {/* THE NAME IS THE PAGE'S `<h1>`, which is why this component renders one rather than
            sitting under a `PageTitle` that would print the same name a second time in a smaller
            face. A player's screen has exactly one subject and it is spelled once.

            `min-w-0` on the column and `[overflow-wrap:anywhere]` on the name — `PageTitle`'s own
            proven pair, and never `truncate`: a title may wrap, but a name that IS the screen must
            not lose characters to a viewport. `break-words` is the trap that pair exists to avoid;
            see `page-title.tsx` for the 607px-in-a-360px-viewport story. */}
        <h1 className="flex min-w-0 flex-col gap-1 [overflow-wrap:anywhere]">
          {/* THE SPOKEN NAME IS ONE STRING, and the first rendered test is what caught why that
              needs saying: two sibling block elements put no whitespace between their text, so
              the heading's accessible name computed as "Ja'MarrChase". The visible pair is
              `aria-hidden` and the real name ships once, in full, to assistive tech. */}
          <span className="sr-only">{player.name}</span>
          {given === null ? null : <span aria-hidden="true" className="text-lg leading-tight text-text-muted">{given}</span>}
          {/* Law 2: on this screen the name is the largest thing, because there is no score here
              to outrank it. 600 is the cap and the range comes from size, never a heavier face. */}
          <span aria-hidden="true" className="font-display text-display-md font-semibold leading-display text-text-primary sm:text-display-lg">{family}</span>
        </h1>
        <span className="flex items-center gap-2 pt-1">
          <PositionBadge position={player.position} size="sm" />
          {player.nflTeam === "" ? null : (
            <span className="rounded-sm bg-surface-raised px-2 py-0.5 font-mono text-xs text-text-muted">{player.nflTeam}</span>
          )}
        </span>
      </div>
    </div>
  );
}

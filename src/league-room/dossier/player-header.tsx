import type { ReactNode } from "react";
import { Avatar, BigNumber, ButtonLink, Card, PlayerObject } from "@/components/ui";
import type { PlayerSeasonBody } from "@/league-service/player";
import { PRODUCT_SEASON } from "@/projections/preseason/current";

/**
 * THE PLAYER'S OWN HEADER, DRAWN ONCE FOR BOTH SURFACES (Sideline research round) — the page and
 * the peek used to spell their own, and the peek's was missing the hero face, the one number and
 * the person who holds him. A player who looks different in the sheet than on his own page is a
 * bug, which is the same ruling `DossierComposition` already makes about everything below this.
 *
 * FOUR THINGS AND NO FIFTH, in the order the principles put them:
 * 1. **the face at 132** (P1: the person comes before the number), on his club's ring;
 * 2. **his name**, the largest type on the screen, with the position sticker and the club under it;
 * 3. **who has him**, as a manager with a face and a name — amber ring when that manager is you,
 *    rose when he is the man you play this week (P6), no ring when he is anyone else;
 * 4. **one big number with its basis** (P2), and one solid verb (P3): the single thing a manager
 *    can do about him from where he is standing.
 *
 * `depth` is the only difference between the two surfaces, and it moves exactly two things: the
 * face's step (a sheet has less vertical room than a page) and whether the header carries its own
 * card. Nothing else may branch on it.
 */
export interface PlayerHeaderProps {
  readonly body: PlayerSeasonBody;
  readonly leagueId: string;
  readonly depth: "peek" | "full";
  /** The sheet's own way out, rendered where the page renders nothing: the peek links to this page
   *  so a deeper look is one press and never lost. */
  readonly trailing?: ReactNode;
}

/**
 * THE ONE NUMBER, AND WHICH RULE SET MADE IT (P2, P11, and the both-bases law this page has kept
 * since the 12.0-versus-14.28 defect: two scoring bases on one screen with neither labelled).
 *
 * The season projection leads when the board has one, because a player page opened in August is a
 * draft question, and it names the format the projection was computed under
 * (`dossier.basis.scoringLabel`) — which is the BOARD's format and not necessarily this league's.
 * Absent a projection, his rate under THIS LEAGUE'S OWN scoring answers instead, and says so.
 * Neither ever borrows the other's caption, and with neither in hand the slot holds a dash and the
 * caption says why (never a zero).
 */
export function heroNumberFor(body: PlayerSeasonBody): { readonly value: string | null; readonly basis: string } {
  const projection = body.dossier?.projection ?? null;
  if (projection !== null) {
    return {
      value: projection.projectedPoints.toFixed(0),
      basis: `Projected for the season, ${body.dossier!.basis.scoringLabel}, ${PRODUCT_SEASON}`,
    };
  }
  if (body.pointsPerGame !== null) {
    return { value: body.pointsPerGame.toFixed(1), basis: `A game, ${body.season}, under this league's scoring` };
  }
  return { value: null, basis: `Nothing scored for him in ${body.season} yet` };
}

/** The amber ring is yours, the rose ring is the man you play this week, and anyone else wears
 *  none — `Avatar`'s own two rings, never a third invented here. */
const RING = { you: "self", rival: "rival", other: undefined } as const;

/**
 * THE ONE THING YOU CAN DO WITH HIM FROM HERE (P3) — decided by who holds him, because that is what
 * changes the act. `null` in a mock room, where the roster fact is a bot's and the verbs it would
 * offer are about a room that does not exist the way a real league does (the same gate
 * `identityLine` keeps on the sentence beside it).
 */
export function verbFor(body: PlayerSeasonBody, leagueId: string): { readonly label: string; readonly href: string } | null {
  if (body.isMockLeague) return null;
  const owner = body.owner ?? null;
  if (owner === null) return { label: "Add him", href: `/app/leagues/${leagueId}/players` };
  if (owner.relation === "you") return { label: "Set your lineup", href: `/app/leagues/${leagueId}/team` };
  const firstName = owner.managerName.trim().split(/\s+/)[0] ?? owner.managerName;
  return { label: `Offer ${firstName} a trade`, href: `/app/leagues/${leagueId}/trades` };
}

/**
 * WHO HAS HIM, AS A PERSON (P1, P6) — and silent in a mock room, where the roster fact is a bot's
 * and telling a manager practising a mock that a player is "a free agent in this league" describes
 * a room that does not exist the way a real league does (Task 4's own context-honesty gate).
 *
 * THREE STATES AND EACH IS HONEST ABOUT WHAT IT KNOWS:
 * - a holder we know as a person: his face, his ring, his team;
 * - a holder we know only as a team name (`ownedBy` with no `owner` — a body assembled before this
 *   round, or a background read with no reader): the team, and NO face, because a face for a person
 *   we have not read would be an invention;
 * - nobody: "Free agent in this league", the product's own phrase for it, everywhere it appears.
 */
function OwnerChip({ body }: { readonly body: PlayerSeasonBody }) {
  if (body.isMockLeague) return null;
  const owner = body.owner ?? null;
  if (owner === null) {
    return <p className="text-sm text-text-muted">{body.ownedBy === null ? "Free agent in this league" : `On ${body.ownedBy}`}</p>;
  }
  return (
    <span data-testid="player-owner" data-relation={owner.relation} className="flex min-w-0 items-center gap-2.5">
      <Avatar name={owner.managerName} avatar={owner.managerAvatar} size="md" ring={RING[owner.relation]} />
      <span className="min-w-0 text-sm text-text-muted">
        {owner.relation === "you" ? (
          <>
            He is yours, on <span className="font-semibold text-text-primary">{owner.teamName}</span>
          </>
        ) : (
          <>
            On <span className="font-semibold text-text-primary">{owner.teamName}</span>, {owner.managerName}
            {owner.relation === "rival" ? "'s team, and you play him this week" : "'s team"}
          </>
        )}
      </span>
    </span>
  );
}

export function PlayerHeader({ body, leagueId, depth, trailing }: PlayerHeaderProps) {
  const hero = heroNumberFor(body);
  const verb = verbFor(body, leagueId);
  const byeWeek = body.dossier?.byeWeek ?? null;

  const inner = (
    // THE PHONE STACKS, THE DESKTOP SITS SIDE BY SIDE. At 360 the verb is a full-width pill under
    // the number rather than beside it: "Offer Dana a trade" is real user content and a label built
    // from somebody's name will always eventually be longer than half a phone.
    <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <PlayerObject
          player={body.player}
          faceSize={depth === "peek" ? "lg" : "xl"}
          chips={
            <>
              {byeWeek === null ? null : <span className="text-sm text-text-muted">Bye {byeWeek}</span>}
              {/* The designation, in the verdict channel: "Q"/"O"/"IR" beside the name is the one
                  fact a manager checks before anything else. Absent means the feed does not name
                  him, and nothing prints. */}
              {body.injuryDesignation === null ? null : (
                <span className="rounded-pill bg-negative px-2 py-0.5 text-xs font-semibold text-negative-text">{body.injuryDesignation}</span>
              )}
            </>
          }
        />
        <OwnerChip body={body} />
      </div>
      <div className="flex w-full shrink-0 flex-col items-start gap-3 sm:w-auto sm:items-end">
        <BigNumber value={hero.value} basis={hero.basis} size={depth === "peek" ? "lg" : "xl"} align="start" className="sm:items-end sm:text-right" />
        <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
          {trailing}
          {verb === null ? null : (
            // ONE SOLID PILL PER VIEWPORT (P3). It is a navigation to where the act happens, so it
            // is `ButtonLink` — the anchor form of the one class map — never a `Link` wearing a
            // hand-rolled copy of it.
            <ButtonLink href={verb.href} variant="verb" size={depth === "peek" ? "md" : "lg"} className="min-w-0 flex-1 sm:flex-none">
              {verb.label}
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );

  // The page's header is its own card on the chalk ground; the sheet already IS a card, and a card
  // inside a card is the padded-box habit Sideline's one material exists to avoid.
  return depth === "full" ? <Card as="header">{inner}</Card> : <header>{inner}</header>;
}

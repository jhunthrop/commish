import { Avatar, PresenceDot } from "@/components/ui";
import type { LeagueMemberCard } from "../contract";
import { firstNameOf } from "../lib/format";

export interface WhoIsHereProps {
  readonly teams: readonly LeagueMemberCard[];
  /** The member ids with a live connection right now, from `usePresence`. */
  readonly present: ReadonlySet<string>;
  /** The viewer's own user id, or `null` for a commissioner with no team of their own. */
  readonly meUserId: string | null;
}

function sentenceFor(names: readonly string[]): string {
  if (names.length === 1) return `${names[0]} is here.`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are here.`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are here.`;
}

/**
 * WHO IS AROUND (P5: the room is a place). The other members whose stream is open right now,
 * faces first, then the sentence. Says nothing at all until the presence store has confirmed at
 * least one open connection (yours counts), so a store we could not read never renders as an
 * empty room, and never renders a number nobody counted.
 */
export function WhoIsHere({ teams, present, meUserId }: WhoIsHereProps) {
  const others = teams.filter((team) => present.has(team.ownerUserId) && team.ownerUserId !== meUserId);
  const confirmed = others.length > 0 || (meUserId !== null && present.has(meUserId));
  if (!confirmed) return null;
  return (
    <div data-testid="who-is-here" className="flex items-center gap-3">
      {others.length === 0 ? null : (
        <span className="flex shrink-0" aria-hidden="true">
          {others.map((team, index) => (
            <Avatar key={team.id} name={team.ownerDisplayName} avatar={team.ownerAvatarUrl} size="md" className={index === 0 ? "" : "-ml-2 ring-2 ring-surface"} />
          ))}
        </span>
      )}
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <PresenceDot />
        <span>{others.length === 0 ? "Just you right now." : sentenceFor(others.map((team) => firstNameOf(team.ownerDisplayName)))}</span>
      </p>
    </div>
  );
}

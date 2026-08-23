import type { Db } from "@/db/client";
import type { AvatarTone } from "@/identity/avatars";
import type { NextActionKind, WeekStatus } from "@/league";
import { crossLeagueHome } from "@/league-service";

/**
 * The rail's own three-way read of a league, derived from `nextAction.kind` and the current
 * week's status — nothing else (Step 3). `"needs-you"` is exactly the kinds that mean "you are
 * the reason this league is stalled": today that is only `"join-draft"`, because `"fix-lineup"`
 * does not exist until Task 10 Step 1b adds it (F1) — a `needs-you` dot with no honest sentence
 * behind it is worse than no dot at all, so this rail claims only the kind that is real right
 * now. `"live"` is a league whose current week is `in_progress`, independent of `nextAction`
 * entirely. Everything else, including "no action at all", is `"quiet"`.
 */
export type RailLeagueState = "needs-you" | "live" | "quiet";

/**
 * One league as the rail renders it: six 40px tiles, never more data than a tile needs.
 * `shortName` is derived by `shortNameFor` below, never stored — a renamed league can never
 * carry a stale initial, and there is no column to migrate (ruling 10). `tone` paints the tile
 * deterministically from the league's own id (`toneFor` below); Task 3's `crestTone` grows
 * `AvatarTone` to six and becomes the shared source for both a league's crest and a member's
 * avatar — this is the five-tone interim until that task lands.
 */
export interface RailLeague {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly tone: AvatarTone;
  readonly state: RailLeagueState;
}

/**
 * The one live fact the top bar can carry — content and shape are Task 9's own (`LiveStatePill`,
 * `HomeBody.liveState`). This type exists here only so `AppShellProps`/`TopBarProps` have a seam
 * to thread through before that task fills it; `shellData` below always answers `null` for it
 * (ruling 12 — no pill beats a pill that pulses on a Tuesday in July), which is always correct
 * because it renders nothing.
 */
export interface LiveState {
  readonly weekNumber: number;
}

export interface ShellData {
  readonly rail: readonly RailLeague[];
  readonly liveState: LiveState | null;
}

const AVATAR_TONES: readonly AvatarTone[] = ["accent", "positive", "negative", "warning", "neutral"];

/**
 * FNV-1a — the same small, stable string hash `draftOrderFor`'s own `hashString`
 * (`@/draft-service/order.ts`) uses, copied rather than imported: that module's hash seeds a
 * draft shuffle, and this one only picks an index into a five-entry palette. Task 3's
 * `crestTone` is the real, shared version this local copy exists only until.
 */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic — the same league id paints the same tile forever, with no crest column to
 *  migrate (ruling 10). */
function toneFor(leagueId: string): AvatarTone {
  return AVATAR_TONES[hashString(leagueId) % AVATAR_TONES.length]!;
}

/**
 * The first letter of each of the first two words, uppercased — "Bay Bandits" → "BB". Falls
 * back to the first two letters of a one-word name — "Ballers" → "BA" (Step 3's own spec).
 */
export function shortNameFor(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]!.charAt(0)}${words[1]!.charAt(0)}`.toUpperCase();
}

function stateFor(kind: NextActionKind | undefined, weekStatus: WeekStatus): RailLeagueState {
  if (kind === "join-draft") return "needs-you";
  if (weekStatus === "in_progress") return "live";
  return "quiet";
}

/**
 * The rail's data, once: `{ rail, liveState }` in one round trip, built on the reads
 * `crossLeagueHome` already performs (Step 3) — this function issues no query of its own.
 * Called exactly once per navigation, by `src/app/app/(shell)/layout.tsx` (ruling 8, as
 * amended); nothing else reads the rail twice.
 */
export async function shellData(db: Db, user: { readonly id: string }): Promise<ShellData> {
  const home = await crossLeagueHome(db, user.id);
  const rail: readonly RailLeague[] = home.leagues.map((league) => ({
    id: league.id,
    name: league.name,
    shortName: shortNameFor(league.name),
    tone: toneFor(league.id),
    state: stateFor(league.nextAction?.kind, league.weekStatus),
  }));
  return { rail, liveState: null };
}

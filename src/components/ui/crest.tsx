import { avatarTone } from "@/identity/avatars";
import { AVATAR_TONE_CLASS } from "./avatar";
import { UI_CONFIG } from "./config";

/**
 * A league's tone, from its id — the exact same deterministic hash `Avatar`'s presets are picked
 * against (`avatarTone`, `@/identity/avatars`), reused rather than reimplemented so a league's
 * crest and its members' avatars are drawn from one palette. Re-exported under this name because
 * every caller here reads "the crest's tone", not "an avatar's tone".
 */
export const crestTone = avatarTone;

/**
 * A name's crest mark, and the ONLY rule in the product that makes one.
 *
 * FOUNDER 2026-08-27: "why do all of my leagues show as O1 on the left hand side?" Because the
 * old rule took the first letter of each of the first two words, and the house factory names its
 * rooms "Open 12-team League 40" — so the mark was "O" plus the 1 from "12-team", identical for
 * every twelve-team league ever created, while the trailing number that actually tells them
 * apart was thrown away. Three leagues, one tile.
 *
 * Worse, there were FIVE rules: this one, `name.slice(0, 2)` at four call sites, and
 * `initialsFor` at a fifth — which is why the same league showed "O1" in the rail and "OP" beside
 * its own heading. `Crest` now takes the NAME and derives the mark itself, so a sixth rule cannot
 * be invented by a caller.
 *
 * The rule, in order:
 *   1. A TRAILING NUMBER SURVIVES, always — in a numbered series it is the whole identity
 *      ("Open 12-team League 40" → "O40").
 *   2. Initials come only from words that START with a letter, so "12-team" can never contribute
 *      a digit that is constant across every room of that size.
 *   3. Otherwise the first letter of the first two words ("Bay Bandits" → "BB"), or the first two
 *      letters of a one-word name ("Ballers" → "BA").
 *
 * Capped at three characters so it always fits the 40px tile: a number long enough to push past
 * that drops the initial rather than overflowing ("... League 100" → "100").
 */
export function shortNameFor(name: string): string {
  const words = name.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return "??";

  const lettered = words.filter((word) => /^[A-Za-z]/.test(word));
  const body = lettered.length > 0 ? lettered : words;
  const trailing = /^\d+$/.test(words[words.length - 1]!) ? words[words.length - 1]! : null;

  if (trailing !== null) {
    const initial = body[0]!.charAt(0).toUpperCase();
    return `${initial}${trailing}`.length <= 3 ? `${initial}${trailing}` : trailing.slice(0, 3);
  }
  if (body.length === 1) return body[0]!.slice(0, 2).toUpperCase();
  return `${body[0]!.charAt(0)}${body[1]!.charAt(0)}`.toUpperCase();
}

export interface CrestProps {
  /** The league (or team) id — the sole input to the deterministic tone hash. */
  readonly id: string;
  /** The league's (or team's) REAL name. The tile derives its own mark from this — a caller
   *  never computes one. Always `aria-hidden`: the accessible name belongs to whatever wraps
   *  this tile — a link, a heading — never to the tile itself. */
  readonly name: string;
  /** Pixel size of the square tile. Defaults to `UI_CONFIG.shell.crestSizePx`, the rail's own
   *  40px tile. */
  readonly size?: number;
  readonly className?: string;
}

/**
 * The two-letter crest tile the mocks repeat: the league rail, the locker-room board, the
 * standings header. Purely presentational — `id` only ever feeds `crestTone`'s hash, `label` is
 * whatever the caller already computed. Extracted at its second real caller (Phase 3.6, Task 3):
 * `LeagueRail` (`@/components/app-shell/league-rail`) carried its own interim tone hash and tile
 * markup until this landed, and was refactored onto this component in the same commit. The mark
 * itself became this component's job on 2026-08-27 — see `shortNameFor` above for why.
 */
export function Crest({ id, name, size = UI_CONFIG.shell.crestSizePx, className = "" }: CrestProps) {
  const tone = crestTone(id);
  const label = shortNameFor(name);
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-md border border-line font-display text-xs font-semibold uppercase ${AVATAR_TONE_CLASS[tone]} ${className}`}
    >
      {label}
    </span>
  );
}

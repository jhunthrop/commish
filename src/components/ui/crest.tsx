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

export interface CrestProps {
  /** The league (or team) id — the sole input to the deterministic tone hash. */
  readonly id: string;
  /** The tile's two-letter mark, e.g. "BB" for "Bay Bandits" (`shortNameFor`,
   *  `@/components/app-shell/shell-data`). Always `aria-hidden`: the accessible name belongs to
   *  whatever wraps this tile — a link, a heading — never to the tile itself. */
  readonly label: string;
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
 * markup until this landed, and was refactored onto this component in the same commit.
 */
export function Crest({ id, label, size = UI_CONFIG.shell.crestSizePx, className = "" }: CrestProps) {
  const tone = crestTone(id);
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

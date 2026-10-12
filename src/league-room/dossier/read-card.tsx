import type { PlayerCapsuleView } from "@research-ts/capsules/store";
import { TEMPLATE_CAPSULE_NOTE } from "@research-ts/capsules/template";
import { Card } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";

export interface ReadCardProps {
  /** `null`/`undefined` renders nothing — the sweep has not reached him yet (a board-irrelevant
   *  player, or one not yet swept), never a placeholder string standing in for that absence. */
  readonly capsule: PlayerCapsuleView | null | undefined;
  /**
   * Which of the capsule's two stored sizes this card states — the peek's own depth ("compact")
   * or the full page's own uncapped Read ("full"). A `"template"`-sourced capsule's own
   * `bodyFull` is not a genuine longer write-up (`capsules/generate.ts`'s own fallback path
   * renders the SAME short template sentence into both sizes when the gateway never returned a
   * usable response for either), so `"full"` reads `bodyCompact` instead in that one case — the
   * honest note below states why, rather than silently serving a "full Read" that is really the
   * short one.
   */
  readonly variant: "compact" | "full";
}

/** The auto-written capsule, restyled as its own module Card ("The read") — dossier plan, Task 5
 *  moved this out of `Outlook`'s own body (where it used to sit directly under the verdict line);
 *  Task 6 makes it a shared module so the peek (compact) and the full page (full, with the
 *  compact-labeled-honestly fallback) read from the identical component rather than two that
 *  could quietly drift apart. */
export function ReadCard({ capsule, variant }: ReadCardProps) {
  if (capsule === null || capsule === undefined) return null;
  const usingCompactFallback = variant === "compact" || capsule.source === "template";
  const body = usingCompactFallback ? capsule.bodyCompact : capsule.bodyFull;
  return (
    <Card as="section" aria-label="The read" className="flex flex-col gap-1">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>The read</h3>
      <p className="text-sm text-text-primary">{body}</p>
      {capsule.source === "template" ? <p className="text-xs text-text-faint">{TEMPLATE_CAPSULE_NOTE}</p> : null}
    </Card>
  );
}

/**
 * THE POST-PICK BEAT — one honest line rendered right after your own pick lands, judging that
 * pick against the card the advisor was showing at the moment you were on the clock
 * (`prePickView`, `use-advisor.ts`'s own latch of exactly that moment).
 *
 * THREE BRANCHES, NEVER A FOURTH. You took the card's pick: "Best available." You passed on him:
 * a second sentence exists ONLY when he carried live make-it-back odds, stated as the simulator's
 * own runs. No pick on the card has nothing to reference, so the beat is null.
 */
import type { AdvisorView } from "@/draft-service/assistant/view";
import { runsText } from "./format";

export interface BeatInput {
  readonly pickedPlayerId: string;
  /** The advisor as it stood at your own turn, right before this pick landed. */
  readonly prePickView: AdvisorView;
  readonly playerName: (id: string) => string;
}

export function postPickBeat({ pickedPlayerId, prePickView, playerName }: BeatInput): string | null {
  const top = prePickView.pick;
  if (top === null) return null;
  if (top.playerId === pickedPlayerId) return "Best available.";
  const first = `Our board had ${playerName(top.playerId)} first.`;
  if (top.makeItBack === null) return first;
  return `${first} ${runsText(top.makeItBack)} still had him at your next turn.`;
}

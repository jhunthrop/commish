/**
 * THE POST-PICK BEAT — Task 7. One honest line rendered right after your own pick lands, judging
 * that pick against the board the Assistant was already showing at the moment you were on the
 * clock (`prePickCall` — `use-assistant.ts`'s own latch of exactly that moment, which survives
 * every other seat's picks until this seat is back on the clock: see that hook's own docblock).
 *
 * THREE BRANCHES, NEVER A FOURTH. You took the board's own top candidate: "Best available." — the
 * shortest honest thing to say. You passed on him: a second sentence exists ONLY when he still
 * carries live make-it-back odds (`oddsPhrase`, imported from its own `odds-phrase.ts` — the
 * product's one quarter-phrasing, shared with `drawer-assistant-tab.tsx` rather than copied) — a
 * candidate with no odds (the draft ended before your next turn in every seeded run, or there IS
 * no next turn) gets the first sentence alone rather than an invented second one. No candidates at
 * all (a call whose shortlist came back empty) has nothing to reference, so the beat is null —
 * absence, not invention.
 */
import type { AssistantCallView } from "@/draft-service/assistant/call";
import { oddsPhrase } from "./odds-phrase";

export interface BeatInput {
  readonly pickedPlayerId: string;
  /** The call as it stood at your own turn, right before this pick landed. */
  readonly prePickCall: AssistantCallView;
  readonly playerName: (id: string) => string;
}

export function postPickBeat(input: BeatInput): string | null {
  const { pickedPlayerId, prePickCall, playerName } = input;
  const top = prePickCall.candidates[0] ?? null;
  if (top === null) return null;
  if (top.playerId === pickedPlayerId) return "Best available.";

  const first = `Our board had ${playerName(top.playerId)} first.`;
  // `top.makeItBack.survival === null` is defensive against `MakeItBackOdds`'s own type only —
  // `call.ts`'s `candidatesWithOdds` already collapses a null-survival row to `makeItBack: null`
  // before it ever reaches an `AssistantCallView`, so this branch is unreachable via today's
  // construction. Kept because the type does not promise that for every future caller.
  if (top.makeItBack === null || top.makeItBack.survival === null) return first;
  return `${first} ${oddsPhrase(top.makeItBack.survival)} he is still there at your next turn.`;
}

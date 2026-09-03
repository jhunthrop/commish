import { MICRO_LABEL } from "@/components/ui/config";
import type { ProofStats } from "@/matchmaking/contract";
import { moneyIsLive } from "@/money/states";
import { PracticeEntryLink } from "./practice-entry-link";

/**
 * TRUST IS FACTS (front door blueprint, 2026-09-02): the stranger's three questions, answered in
 * facts, never adjectives — who runs it, where money lives, and what a first-timer can do before
 * anything counts. Under the cards, the operator's own earned numbers as one quiet line:
 * `proofStats`' floors decide what appears, and a null is an absent phrase, never a zero (law 7
 * — the discipline the retired `FrontDoorLowerThird` carried moves here whole; the rating cell
 * stays retired, the nav's own Reviews entry is that room's one honest door).
 *
 * The money card DERIVES its sentence from `moneyIsLive()` (injectable `live`, the
 * `FrontDoorHero` idiom): the free season claims nothing about wallets it is not operating for
 * real money yet, and the live sentence describes the wallet and withdrawal machinery that
 * actually exists behind the switch. The practice card's link is `PracticeEntryLink` — the
 * blueprint's own home for the invitation the hero used to carry, with its honest signed-out
 * label.
 */
export interface TrustFactsProps {
  readonly stats: ProofStats;
  readonly signedIn: boolean;
  /** Defaults to the real `moneyIsLive()` — injectable so a test can exercise the live card
   *  without editing shipped state. */
  readonly live?: boolean;
}

const CARDS = {
  whoRunsIt:
    "The house runs the league: the draft room, the schedule, the scoring and the trade deadlines. No commissioner's cousin settles disputes.",
  moneyLive: "Your buy-in sits in your wallet until the draft fires. Withdraw anything unspent, anytime.",
  moneyFree: "Every league is free this season. No buy-ins, no deposits, nothing to chase.",
  neverPlayed: "Run a practice draft against bots first. Nothing counts, nothing costs.",
} as const;

/** The earned proof phrases, floors already applied by `proofStats` — absent, never dressed up. */
export function proofPhrases(stats: ProofStats): readonly string[] {
  const phrases: string[] = [];
  if (stats.leaguesFilled !== null) phrases.push(`${stats.leaguesFilled} leagues filled this season`);
  if (stats.roomsFillingNow !== null) phrases.push(`${stats.roomsFillingNow} rooms filling right now`);
  return phrases;
}

function FactCard({ label, fact, children }: { readonly label: string; readonly fact: string; readonly children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 basis-64 flex-col gap-1.5 rounded-md bg-surface-inset px-3.5 py-3">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>{label}</h3>
      <p className="text-sm text-text-muted">{fact}</p>
      {children}
    </div>
  );
}

export function TrustFacts({ stats, signedIn, live = moneyIsLive() }: TrustFactsProps) {
  const phrases = proofPhrases(stats);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <FactCard label="Who runs it" fact={CARDS.whoRunsIt} />
        <FactCard label={live ? "Where money lives" : "What it costs"} fact={live ? CARDS.moneyLive : CARDS.moneyFree} />
        <FactCard label="Never played?" fact={CARDS.neverPlayed}>
          <PracticeEntryLink signedIn={signedIn} className="mt-auto pt-1" />
        </FactCard>
      </div>
      {phrases.length === 0 ? null : (
        <p className="text-sm tabular-nums text-text-muted" data-testid="proof-line">
          {phrases.join(" · ")}
        </p>
      )}
    </div>
  );
}

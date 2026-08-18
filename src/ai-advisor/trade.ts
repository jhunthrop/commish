import { isBalancedProposal, type TradeProposal } from "@/domain/trade";
import { valuePlayers, type AdvisorContext, type AdvisorTeamContext } from "./context";
import { tradePrompt } from "./prompt";
import { adviseOrFallback, type Advice, type AdvisorLlmDeps } from "./start-sit";
import { tradeBalance, type TradeBalance } from "./valuation";

export interface TradeAssessment extends Advice {
  readonly verdict: TradeBalance["verdict"];
  readonly flags: TradeBalance["flags"];
  readonly givingValue: number;
  readonly receivingValue: number;
}

export type TradeAnalyzerFn = (input: {
  readonly context: AdvisorContext;
  readonly opponent: AdvisorTeamContext;
  readonly proposal: TradeProposal;
}) => Promise<TradeAssessment | null>;

const VERDICT_COPY: Readonly<Record<TradeBalance["verdict"], string>> = {
  even: "This looks close to even on weekly production.",
  favors_proposer: "This leans your way on weekly production.",
  favors_receiver: "This leans their way on weekly production.",
  lopsided: "This is a long way from even on weekly production.",
};

const FLAG_COPY: Readonly<Record<TradeAssessment["flags"][number], string>> = {
  empty_side: "one side isn't sending anybody",
  uneven_player_count: "the sides aren't sending the same number of players",
  value_gap_over_threshold: "the per-week gap between the two sides is large",
};

function baselineAssessment(balance: TradeBalance): Advice {
  const reasons = balance.flags.map((flag) => FLAG_COPY[flag]);
  const detail = `You'd send about ${balance.givingValue} points a week and get back about ${balance.receivingValue}.`;
  return {
    headline: VERDICT_COPY[balance.verdict],
    reasoning: reasons.length === 0 ? detail : `${detail} Worth a second look: ${reasons.join("; ")}.`,
    degraded: true,
  };
}

/**
 * Assess a proposed trade. **Nothing here executes one** — there is no accept path, no write,
 * and no persisted proposal; a trade happens only when two humans agree somewhere this phase
 * hasn't built yet.
 *
 * The verdict comes from `tradeBalance` — the same pure function the platform's later
 * collusion/trade-fairness sweep runs — so what a manager is told and what integrity tooling
 * flags can never be two different opinions. The model only writes the explanation, and a
 * disabled or slow model costs the prose, never the verdict.
 */
export function createTradeAnalyzer(deps: AdvisorLlmDeps): TradeAnalyzerFn {
  return async ({ context, opponent, proposal }) => {
    if (!isBalancedProposal(proposal)) return null;

    const giving = valuePlayers(context.me, proposal.from.playerIds);
    const receiving = valuePlayers(opponent, proposal.to.playerIds);
    // A named player neither roster holds is a shape error, not a lopsided trade: valuing a
    // ghost at zero would produce a confident verdict about a trade nobody can make.
    if (giving.length !== proposal.from.playerIds.length) return null;
    if (receiving.length !== proposal.to.playerIds.length) return null;

    const balance = tradeBalance(giving, receiving);
    const advice = await adviseOrFallback(
      deps,
      tradePrompt(context, proposal, balance, giving, receiving),
      baselineAssessment(balance),
    );

    return {
      ...advice,
      verdict: balance.verdict,
      flags: balance.flags,
      givingValue: balance.givingValue,
      receivingValue: balance.receivingValue,
    };
  };
}

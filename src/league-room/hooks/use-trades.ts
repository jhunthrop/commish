"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { TradeBalance } from "@/trades/fairness";
import type { ProposeTradeBody, TradeProposalView, TradesPageBody } from "@/trades/contract";
import type { TradeAssessmentBody } from "../contract";
import { useLeagueRoomDeps } from "./deps";

export type TradesStatus = "loading" | "ready" | "error";

/** `POST /api/leagues/[leagueId]/trades`'s success body: the new offer's id, and the proposer's
 *  own private, advisory read on it — the SAME shape the route answers with (`ProposeTradeResult`,
 *  `@/league-service/trades`), restated here because that type is not exported across the client
 *  boundary. */
export interface ProposedTrade {
  readonly tradeId: string;
  readonly verdict: TradeBalance;
}

export type TradeDecision = "accept" | "reject" | "withdraw";

export interface DecidedTrade {
  readonly tradeId: string;
  readonly status: TradeProposalView["status"];
}

/** What the caller of any mutating action gets back: the new row on success, or the server's own
 *  reason on failure — never a thrown exception, so a caller never needs a `try/catch` of its own. */
export type TradeActionResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: string };

const CONNECTION_FAILED_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

async function postJson<T>(
  fetchJson: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  body: unknown,
): Promise<TradeActionResult<T>> {
  try {
    const response = await fetchJson(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const envelope = (await response.json()) as ApiEnvelope<T>;
    if (!envelope.ok) return { ok: false, error: envelope.error };
    return { ok: true, data: envelope.data };
  } catch {
    return { ok: false, error: CONNECTION_FAILED_MESSAGE };
  }
}

export interface UseTradesResult {
  readonly inbox: readonly TradeProposalView[];
  readonly outbox: readonly TradeProposalView[];
  readonly history: readonly TradeProposalView[];
  readonly meTeamId: string | null;
  readonly status: TradesStatus;
  readonly error: string | null;
  readonly refetch: () => Promise<void>;
  /** `POST /api/leagues/[leagueId]/trades`. Refetches the three bands on success, so the new
   *  offer moves into `outbox` the same way every other mutation here re-reads rather than
   *  hand-folds its own optimistic copy of server state. */
  readonly propose: (input: ProposeTradeBody) => Promise<TradeActionResult<ProposedTrade>>;
  /** `POST /api/leagues/[leagueId]/trades/[tradeId]` with `{action}`. Refetches on success. */
  readonly decide: (tradeId: string, action: TradeDecision) => Promise<TradeActionResult<DecidedTrade>>;
  /** `POST /api/leagues/[leagueId]/advisor/trade` — the same advisory read `TradeComposer` shows
   *  before a manager sends an offer, reused here so `TradeInbox` can show the SAME kind of
   *  advisory read to the manager ANSWERING one, from their own perspective. Never stored, never
   *  the counterparty's private read — a fresh call every time it's asked for, same as
   *  `AdvisorPanel`'s own `ask`. */
  readonly assess: (input: { weekNumber: number; counterpartyTeamId: string; give: readonly string[]; receive: readonly string[] }) => Promise<TradeActionResult<TradeAssessmentBody>>;
}

const EMPTY_PAGE: TradesPageBody = { leagueId: "", meTeamId: "", inbox: [], outbox: [], history: [] };

/**
 * The trade room's one data layer: fetch the caller's own three bands (`GET
 * /api/leagues/[leagueId]/trades`) and expose the mutating actions every surface in this room
 * calls through. Follows `useNotices`' shape (`src/account-room/hooks/use-notices.ts`): a mount
 * fetch, and `generationRef` — the same idiom `useNotices`'/`useLiveScores`' own guards use —
 * bumped by every write (the mount fetch, an explicit `refetch`, and every successful mutation's
 * own follow-up refetch) so a slow response can never clobber a fresher one that resolved first.
 *
 * There is no stream here, deliberately: trades carry no SSE frame (`docs/conventions.md`'s
 * client-boundary list names no trade event), so unlike `useLiveScores`/`useNotices` this hook is
 * plain request/response — a manager who wants the newest state pulls with `refetch`, and every
 * mutation already does that for them.
 */
export function useTrades(leagueId: string): UseTradesResult {
  const { fetchJson } = useLeagueRoomDeps();
  const [page, setPage] = useState<TradesPageBody>(EMPTY_PAGE);
  const [status, setStatus] = useState<TradesStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const refetch = useCallback(async (): Promise<void> => {
    const generationBeforeRequest = generationRef.current;
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/trades`);
      const envelope = (await response.json()) as ApiEnvelope<TradesPageBody>;
      if (generationRef.current !== generationBeforeRequest) return; // a newer write already won
      if (!envelope.ok) {
        setStatus("error");
        setError(envelope.error);
        return;
      }
      generationRef.current += 1;
      // Merged onto `EMPTY_PAGE` rather than trusted whole: every real caller of this route
      // (`listTrades`) always answers with all four fields, but a test double's own default
      // envelope (used by callers that only care about SOME other fetch) may not — and this hook
      // has other consumers (`TradeInboxLink`) that read `inbox.length` unconditionally once
      // `status` is "ready".
      setPage({ ...EMPTY_PAGE, ...envelope.data });
      setStatus("ready");
      setError(null);
    } catch {
      if (generationRef.current !== generationBeforeRequest) return;
      generationRef.current += 1;
      setStatus("error");
      setError(CONNECTION_FAILED_MESSAGE);
    }
  }, [fetchJson, leagueId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const propose = useCallback(
    async (input: ProposeTradeBody): Promise<TradeActionResult<ProposedTrade>> => {
      const result = await postJson<ProposedTrade>(fetchJson, `/api/leagues/${leagueId}/trades`, input);
      if (result.ok) {
        generationRef.current += 1;
        void refetch();
      }
      return result;
    },
    [fetchJson, leagueId, refetch],
  );

  const decide = useCallback(
    async (tradeId: string, action: TradeDecision): Promise<TradeActionResult<DecidedTrade>> => {
      const result = await postJson<DecidedTrade>(fetchJson, `/api/leagues/${leagueId}/trades/${tradeId}`, { action });
      if (result.ok) {
        generationRef.current += 1;
        void refetch();
      }
      return result;
    },
    [fetchJson, leagueId, refetch],
  );

  const assess = useCallback(
    async (input: { weekNumber: number; counterpartyTeamId: string; give: readonly string[]; receive: readonly string[] }): Promise<
      TradeActionResult<TradeAssessmentBody>
    > => postJson<TradeAssessmentBody>(fetchJson, `/api/leagues/${leagueId}/advisor/trade`, input),
    [fetchJson, leagueId],
  );

  return {
    inbox: page.inbox,
    outbox: page.outbox,
    history: page.history,
    meTeamId: page.meTeamId === "" ? null : page.meTeamId,
    status,
    error,
    refetch,
    propose,
    decide,
    assess,
  };
}

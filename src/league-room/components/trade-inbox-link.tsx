"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { useTrades } from "../hooks/use-trades";

export interface TradeInboxLinkProps {
  readonly leagueId: string;
}

/**
 * The league home's one new link (Task 8): "Trades", with a `Badge` count of offers still
 * waiting on the caller's own answer. A `"use client"` leaf `LeagueHome` renders directly, the
 * same shape `AdvisorPanel`/`InvitePanel` already are — it fetches its own data over `useTrades`
 * rather than `LeagueHomeBody` growing a field for it, so this task touches no server read and
 * no query budget (`read.ts`'s own `BASELINE_LEAGUE_HOME_QUERIES` stays 8). No new visual
 * mapping: the badge is the `Badge` primitive, the glyph is `inbox` (ruling 29), same as the
 * header's own `NoticeInbox` trigger.
 */
export function TradeInboxLink({ leagueId }: TradeInboxLinkProps) {
  const { inbox, status } = useTrades(leagueId);
  const count = status === "ready" ? inbox.length : 0;

  return (
    <Link className="flex items-center gap-1 text-sm text-accent underline" href={`/app/leagues/${leagueId}/trades`}>
      <Icon name="inbox" size={16} />
      Trades
      {count === 0 ? null : <Badge tone="accent">{count}</Badge>}
    </Link>
  );
}

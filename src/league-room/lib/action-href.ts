import type { HomeLeagueCard } from "../contract";

/**
 * Where a league's one next-action control goes — shared by `HomeLeagueCard` and `LeagueBoard`
 * so the two can never disagree about the same league's own destination. Draft-phase actions
 * (`join-draft`/`open-draft-room`) go to the draft room; `fix-lineup`/`set-lineup` land on the
 * editor itself rather than a league home the manager then has to scan (F16) — Task 11 Step 1
 * gives `LineupEditor` the `id="lineup"` that makes the `#lineup` fragment actually land. Every
 * other action goes to the league's own home, where `InvitePanel` and the week's
 * `MatchupScoreboard` already live.
 */
export function actionHref(league: Pick<HomeLeagueCard, "id" | "draftId" | "nextAction">): string {
  const kind = league.nextAction?.kind;
  if ((kind === "join-draft" || kind === "open-draft-room") && league.draftId !== null) {
    return `/app/drafts/${league.draftId}`;
  }
  if (kind === "fix-lineup" || kind === "set-lineup") {
    // The tab split (founder, 2026-08-28): the lineup editor lives on the My team tab now, so the
    // verb lands there — the #lineup anchor survives on the editor itself.
    return `/app/leagues/${league.id}/team#lineup`;
  }
  return `/app/leagues/${league.id}`;
}

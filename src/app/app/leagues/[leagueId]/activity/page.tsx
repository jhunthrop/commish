import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { leagueNameFor } from "@/draft-service/teams";
import { listLeagueActivity } from "@/integrity-service/activity";
import { listNotices, quoteFor } from "@/integrity-service/notify";
import { InfoTip, PageTitle } from "@/components/ui";
import { ActivityFeed } from "@/league-room/components/activity-feed";
import { AppHeader } from "@/components/app-shell/app-header";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const first = (value: string | readonly string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;

/** A `before` cursor is a raw `sequence` from a previous page's `nextBefore` — an untrusted
 *  query param, so a value that isn't a positive integer is treated as "no cursor" (the newest
 *  page) rather than passed through to the query. */
function parseBefore(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * A Server Component, same shape as `LeaguePage`/`MatchupWeekPage`: `requireCurrentUser`, then
 * membership, then the reads. `resolveLeagueMembership` rather than `leagueHome` — this page
 * needs only "does this league exist and does this caller belong to it", not the standings/
 * terms/matchup bundle `leagueHome` assembles for the league home page.
 *
 * A stranger — a signed-in caller who fields no team here and isn't the commissioner — gets
 * `notFound()` (404), never a 403: the same non-oracle discipline `publicJoinPrecondition`
 * (`@/league-service/join.ts`) and `LeaguePage` already use. A 403 would confirm that a guessed
 * league id names a real league; a 404 means the same thing whether the id is wrong or the
 * caller just isn't a member of a real league.
 */
export default async function LeagueActivityPage({ params, searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const { leagueId } = await params;
  const query = await searchParams;
  const before = parseBefore(first(query.before));

  const membership = await resolveLeagueMembership(getDb(), leagueId, user.id);
  if (!membership.ok) notFound();
  if (membership.membership.teamId === null && !membership.membership.isCommissioner) notFound();

  const [activity, noticesPage, leagueName] = await Promise.all([
    listLeagueActivity(getDb(), { leagueId, viewerUserId: user.id, before }),
    listNotices(getDb(), user.id),
    leagueNameFor(getDb(), leagueId),
  ]);

  // The viewer's OWN notices for THIS league — a separate band from the chronological feed
  // below, because "what happened here" and "what happened to me" are two different questions
  // with two different cursors (`listNotices`' bounded, cursorless page vs. `listLeagueActivity`'s
  // paged chain walk). `listNotices` is never league-scoped at the query — it is the same
  // bounded, cursorless inbox page the header's `NoticeInbox` reads — so this page filters it
  // down to this league rather than asking the service for something narrower.
  const leagueNotices = noticesPage.notices.filter((notice) => notice.leagueId === leagueId);

  return (
    <>
      <AppHeader displayName={user.displayName} avatar={user.avatarUrl} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <header className="flex flex-col gap-1">
          <PageTitle>League activity</PageTitle>
          <p className="text-sm text-text-muted">{leagueName}</p>
        </header>

        {leagueNotices.length === 0 ? null : (
          <section className="flex flex-col gap-2" aria-label="What the platform did">
            <h2 className="text-lg font-medium text-text-primary">What the platform did</h2>
            <ul className="flex flex-col">
              {leagueNotices.map((notice) => {
                const quote = quoteFor(notice);
                return (
                  <li key={notice.id} className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0">
                    <p className="font-medium text-text-primary">{notice.title}</p>
                    <p className="text-sm text-text-muted">
                      {notice.body}
                      {notice.noticeType === "draft_auto_picked" ? <InfoTip term="queue" className="ml-1" /> : null}
                    </p>
                    {/* Fix round 1, FIX 7: an operator's own words, laid out as a real
                        quotation rather than folded into `body`'s own sentence. */}
                    {quote === null ? null : (
                      <blockquote className="border-l-2 border-border pl-3 text-sm italic text-text-muted">{`"${quote}"`}</blockquote>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Fix round 1, FIX 5: the persona panel's high-stakes-veteran question, answered
            plainly rather than left implicit in `lineup_change` simply never appearing here for
            anyone but its own actor. */}
        <p className="text-sm text-text-muted">Lineup changes appear only in your own history. Nobody else in this league can see them.</p>

        <ActivityFeed rows={activity.rows} leagueId={leagueId} nextBefore={activity.nextBefore} />
      </main>
    </>
  );
}

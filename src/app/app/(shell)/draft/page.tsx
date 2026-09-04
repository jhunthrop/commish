import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { ButtonLink, Card, PageTitle, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { countdownLabel, draftHqBody } from "@/draft-hq/hq/service";
import { DraftSubnav } from "@/draft-hq/subnav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pageTitle("Draft HQ");

/** A future surface's card: one honest sentence, never a fabricated stat (the phase-1 boundary,
 *  spec §13 item 1 — Simulator/Assistant/Market/Playbook are phases 2-4). */
function FutureSurfaceCard({ eyebrow, title, sentence, href, verb }: { readonly eyebrow: string; readonly title: string; readonly sentence: string; readonly href: string; readonly verb: string }) {
  return (
    <Card as="article" className="flex flex-col gap-2">
      <span className={`${MICRO_LABEL} text-text-faint`}>{eyebrow}</span>
      <h2 className="font-display text-lg font-semibold leading-display text-text-primary">{title}</h2>
      <p className="flex-1 text-sm text-text-muted">{sentence}</p>
      <Link href={href} className="text-sm font-medium text-accent hover:underline">
        {verb}
      </Link>
    </Card>
  );
}

/**
 * DRAFT HQ (spec §13 item 1) — the section's landing page. Every number on it traces to a real
 * row: the league-context banner is derived from the caller's actual next-drafting league's
 * stored roster shape, the countdown is that draft's real `kickoff_at`, the board preview is the
 * top of the real evidence board, and the sheet card is the caller's real entry count (or an
 * honest "you have not started one yet" when none exists). The four cards behind phase 1
 * (Simulator, Assistant, Market, Playbook) carry one sentence each and no invented stat.
 */
export default async function DraftHqPage() {
  const user = await requireCurrentUser();
  const db = getDb();
  const body = await draftHqBody(db, user.id);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <DraftSubnav current="hq" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <PageTitle>Draft HQ</PageTitle>
          <p className="text-sm text-text-muted">Everything between you and a roster you do not apologize for.</p>
        </div>
        {body.nextDraft === null ? null : (
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-display text-3xl font-bold leading-display text-accent">{countdownLabel(new Date(body.nextDraft.kickoffAt), now)}</span>
            <span className={`${MICRO_LABEL} text-text-faint`}>Until your {body.nextDraft.leagueName} draft</span>
          </div>
        )}
      </div>

      {body.nextDraft?.rosterNote ? (
        <Card className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-text-primary">{body.nextDraft.rosterNote}</span>
          <ButtonLink href="/app/draft/board" variant="secondary" size="sm" className="ml-auto">
            See your board
          </ButtonLink>
        </Card>
      ) : null}

      {body.nextDraft === null ? (
        <Card className="text-sm text-text-muted">
          You have no draft scheduled yet. Once a league schedules one, its countdown and its own rules show up here.
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card as="article" className="flex flex-col gap-2">
          <span className={`${MICRO_LABEL} text-text-faint`}>The Board</span>
          <h2 className="font-display text-lg font-semibold leading-display text-text-primary">Evidence rankings, receipts on every row</h2>
          {body.boardPreview.length === 0 ? (
            <p className="text-sm text-text-muted">The board has not been built for this season yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {body.boardPreview.map((row, index) => (
                <li key={row.playerId} className="flex items-center gap-2 border-b border-line/50 py-1 text-sm last:border-b-0">
                  <span className="w-4 tabular-nums text-text-faint">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{row.name}</span>
                  <span className="tabular-nums text-text-muted">{row.projectedPoints.toFixed(1)}</span>
                  <PositionBadge position={row.position} rank={row.positionRankInValue ?? undefined} size="sm" />
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-text-muted">Tiers, floors and ceilings, risk flags, and the evidence behind every rank. Nothing on it is an opinion.</p>
          <Link href="/app/draft/board" className="text-sm font-medium text-accent hover:underline">
            Open the board
          </Link>
        </Card>

        <Card as="article" className="flex flex-col gap-2">
          <span className={`${MICRO_LABEL} text-text-faint`}>My Sheet</span>
          <h2 className="font-display text-lg font-semibold leading-display text-text-primary">Yours, everywhere you draft</h2>
          {body.sheetEntryCount === null ? (
            <p className="flex-1 text-sm text-text-muted">You have not started a sheet yet. Seed one from the board in one press.</p>
          ) : (
            <p className="flex-1 text-2xl font-semibold tabular-nums text-text-primary">{body.sheetEntryCount} ranked</p>
          )}
          <p className="text-sm text-text-muted">Tiers, notes, targets and never-drafts. Synced into every room, printable for the basement draft.</p>
          <Link href="/app/draft/sheet" className="text-sm font-medium text-accent hover:underline">
            {body.sheetEntryCount === null ? "Start my sheet" : "Edit my sheet"}
          </Link>
        </Card>

        <FutureSurfaceCard
          eyebrow="The Simulator"
          title="1,000 drafts before your real one"
          sentence="Not built yet. It arrives next, running the real draft engine thousands of times from your slot."
          href="/app/draft/simulator"
          verb="See what's coming"
        />
        <FutureSurfaceCard
          eyebrow="The Assistant"
          title="The autopick brain, on your side"
          sentence="The live version already argues your side in your draft room's right rail. This demo page is not built yet."
          href="/app/draft/assistant"
          verb="See what's coming"
        />
        <FutureSurfaceCard
          eyebrow="The Market"
          title="Where the room is wrong"
          sentence="Not built yet. The Board already shows today's market edge on every ranked player; trends and alerts arrive with this surface."
          href="/app/draft/market"
          verb="See what's coming"
        />
        <FutureSurfaceCard
          eyebrow="The Playbook"
          title="Strategy, but backtested"
          sentence="Not built yet. It arrives once the simulator can back a strategy card with real runs, rather than a claim nobody tested."
          href="/app/draft/playbook"
          verb="See what's coming"
        />
      </div>
    </div>
  );
}

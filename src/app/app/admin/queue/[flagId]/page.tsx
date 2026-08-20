import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { flagDetail } from "@/integrity-service/flags";
import { leagueNameFor } from "@/draft-service/teams";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { renderNotice } from "@/integrity/notices";
import { DECISION_PHRASE, type FlagResolutionView, type FlagSubjectView } from "@/integrity/queue-view";
import type { ResolutionDecision } from "@/integrity/flags";
import { AppHeader } from "@/components/app-shell/app-header";
import { Card, PageTitle } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { withAdmin } from "@/app/api/admin/_shared";
import { ResolutionForm, type DecisionPreview } from "@/admin-room/components/resolution-form";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly flagId: string }>;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function SubjectCard({ subject }: { readonly subject: FlagSubjectView }) {
  if (subject.kind === "review") {
    return (
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Reported review</p>
        <p className="mt-1 text-sm text-text-muted">By {subject.authorName}</p>
        <p className="mt-2 break-words text-sm text-text-primary">{subject.body}</p>
      </Card>
    );
  }
  if (subject.kind === "chat_message") {
    return (
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Reported message</p>
        <p className="mt-1 text-sm text-text-muted">From {subject.authorName}</p>
        <p className="mt-2 break-words text-sm text-text-primary">{subject.body ?? "This message is no longer here."}</p>
      </Card>
    );
  }
  if (subject.kind === "account_pair") {
    return (
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Accounts</p>
        <p className="mt-2 break-words text-sm text-text-primary">
          {subject.names[0]} and {subject.names[1]}
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Trade</p>
      <p className="mt-2 text-sm text-text-primary">{subject.tradeId}</p>
    </Card>
  );
}

/**
 * The static half of every notice a decision this flag's subject supports could send —
 * `renderNotice` (`@/integrity/notices`), called SERVER-SIDE and handed down as plain data, is
 * how the resolution form previews the exact notice without `src/admin-room/**` ever value-
 * importing `@/integrity` (the client boundary, `eslint.config.mjs`). `note`/`reason` are never
 * interpolated into either template's body (`notices.ts`'s own templates), so the placeholder
 * passed here is never rendered — only `leagueName` matters, and it is real.
 */
function noticePreviewsFor(leagueName: string): Readonly<Record<"warned_user" | "content_removed", DecisionPreview>> {
  return {
    warned_user: renderNotice("operator_warning", { leagueName, note: "" }),
    content_removed: renderNotice("review_removed", { reason: "" }),
  };
}

/**
 * What an operator sees once a flag is ALREADY resolved — fix round 1, FIX 5. Replaces the old
 * bare "This flag is already resolved." sentence, which said a decision existed but nothing
 * about what it was, who made it, or when: an operator revisiting a flag (their own `router.
 * refresh()` after submitting, or a second operator checking the queue later) could not answer
 * "what happened here" without leaving this page for the trail's own headline further down.
 * `DECISION_PHRASE` (`@/integrity/queue-view`) is the SAME wording the trail already uses for
 * this decision — one phrase, read from one place, not a second copy that could drift from it.
 */
function ResolutionSummary({ resolution }: { readonly resolution: FlagResolutionView }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-primary">
        <span className="font-medium">{resolution.resolvedByName}</span> {DECISION_PHRASE[resolution.decision]} on {formatWhen(resolution.resolvedAt)}.
      </p>
      {resolution.note.length === 0 ? null : (
        <blockquote className="border-l-2 border-border pl-3 text-sm italic text-text-muted">{`"${resolution.note}"`}</blockquote>
      )}
    </div>
  );
}

/**
 * `content_removed` is wired ONLY for a `review` subject today (`resolveFlag`'s own
 * `removeSubject` — Task 6 lands the chat sibling). Filtered out here rather than left for the
 * service to refuse, so an operator is never offered a decision that would 500 on submit.
 */
function decisionsFor(decisions: readonly ResolutionDecision[], subject: FlagSubjectView): readonly ResolutionDecision[] {
  return decisions.filter((decision) => decision !== "content_removed" || subject.kind === "review");
}

/**
 * The detail page: `withAdmin`'s Server Component overload, then `flagDetail`, then render.
 * `flagDetail` returning `null` (a flag id that names nothing) is `notFound()` — the same
 * non-oracle discipline the gate itself holds to, so a guessed id and a real-but-inaccessible one
 * read identically.
 */
export default async function AdminFlagDetailPage({ params }: PageProps) {
  const { flagId } = await params;

  return withAdmin(async (operator) => {
    const detail = await flagDetail(getDb(), flagId);
    if (detail === null) notFound();

    const leagueName = detail.leagueId === null ? "your league" : await leagueNameFor(getDb(), detail.leagueId);
    const previews = noticePreviewsFor(leagueName);
    const decisions = decisionsFor(detail.decisions, detail.subject);
    const evidenceEntries = Object.entries(detail.evidence);

    return (
      <>
        <AppHeader displayName={operator.displayName} avatar={operator.avatarUrl} isAdmin={operator.isAdmin} />
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
          <header className="flex flex-col gap-1">
            <PageTitle>Flag detail</PageTitle>
            <time dateTime={detail.raisedAt} className="text-sm text-text-muted">
              Raised {formatWhen(detail.raisedAt)}
            </time>
          </header>

          <SubjectCard subject={detail.subject} />

          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Evidence</p>
            {evidenceEntries.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">No evidence recorded for this flag.</p>
            ) : (
              <dl className="mt-2 flex flex-col gap-1">
                {evidenceEntries.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3 text-sm">
                    <dt className="text-text-muted">{key}</dt>
                    <dd className="break-all text-text-primary">{JSON.stringify(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Reporters</p>
            {detail.reporters.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">Nobody reported this. The platform raised it on its own.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {detail.reporters.map((reporter) => (
                  <li key={reporter.userId} className="text-sm">
                    <span className="font-medium text-text-primary">{reporter.name}</span>{" "}
                    <span className="text-text-muted">
                      reported &ldquo;{reporter.reason}&rdquo; on {formatWhen(reporter.reportedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">What happened</p>
            {detail.trail.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">No recorded history for this flag yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col" aria-label="Flag history">
                {detail.trail.map((row) => (
                  <li key={row.eventId} className="flex items-start gap-3 border-b border-border py-3 last:border-b-0">
                    <Icon name={row.icon} size={18} className="mt-0.5 shrink-0 text-text-muted" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="break-words text-sm text-text-primary">{row.headline}</p>
                      <time dateTime={row.occurredAt} className="text-xs text-text-muted">
                        {formatWhen(row.occurredAt)}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-text-muted">Decision</p>
            {detail.resolution !== null ? (
              <ResolutionSummary resolution={detail.resolution} />
            ) : (
              <ResolutionForm flagId={detail.flagId} decisions={decisions} noteMaxLength={INTEGRITY_CONFIG.moderation.noteMaxLength} previews={previews} />
            )}
          </Card>
        </main>
      </>
    );
  });
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import type { JsonObject } from "@/domain/audit";
import { flagDetail } from "@/integrity-service/flags";
import { leagueNameFor } from "@/draft-service/teams";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { renderNotice } from "@/integrity/notices";
import { DECISION_PHRASE, subjectIsRemoved, type FlagResolutionView, type FlagSubjectView, type TradedPlayerView } from "@/integrity/queue-view";
import { contentRemovalIsWiredFor, type ResolutionDecision } from "@/integrity/flags";
import { Card, EYEBROW, PageTitle } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import { withAdmin } from "@/app/api/admin/_shared";
import { ResolutionForm, type DecisionPreview } from "@/admin-room/components/resolution-form";
import { HeldTradeDetail, type HeldTradeSubject } from "@/admin-room/components/held-trade-detail";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: honest static title — the real one (held trade vs. flag detail) depends on a DB read
// (`flagDetail`, below) this task does not duplicate for a browser tab.
export const metadata: Metadata = pageTitle("Dispute detail");

interface PageProps {
  readonly params: Promise<{ readonly flagId: string }>;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * States, in the operator's own words, that this content is ALREADY gone (final review, MEDIUM
 * 8). It is the reason `decisionsFor` withholds `content_removed` below, so an operator who
 * notices one decision missing has the answer on the same card rather than in a 409.
 *
 * The operator still sees the words. That is deliberate and it is the whole point of a fresh
 * report on removed content: the question in front of them is whether to warn the author, and
 * they cannot answer it without reading what was written. A removed row keeps its body forever
 * (the stamp-never-delete discipline `reviews` and `chat_messages` share); only the MEMBER-facing
 * wire withholds it.
 */
function AlreadyRemovedNote() {
  return <p className="mt-2 text-sm text-text-muted">We already removed this content. You can still close this flag or warn the member.</p>;
}

/** Every subject kind EXCEPT `held_trade` — `held-trade-detail.tsx` is its own whole surface
 *  (Task 5's brief: "shows what the operator needs and nothing else"), not a card plus the
 *  generic decision form every OTHER flag type shares. `AdminFlagDetailPage` dispatches to it
 *  directly rather than routing it through `SubjectCard`. */
type OrdinarySubject = Exclude<FlagSubjectView, { readonly kind: "held_trade" }>;

function SubjectCard({ subject }: { readonly subject: OrdinarySubject }) {
  if (subject.kind === "review") {
    return (
      <Card>
        <p className={`${EYEBROW} text-text-muted`}>Reported review</p>
        <p className="mt-1 text-sm text-text-muted">By {subject.authorName}</p>
        <p className="mt-2 break-words text-sm text-text-primary">{subject.body}</p>
        {subjectIsRemoved(subject) ? <AlreadyRemovedNote /> : null}
      </Card>
    );
  }
  if (subject.kind === "chat_message") {
    return (
      <Card>
        <p className={`${EYEBROW} text-text-muted`}>Reported message</p>
        <p className="mt-1 text-sm text-text-muted">From {subject.authorName}</p>
        <p className="mt-2 break-words text-sm text-text-primary">{subject.body ?? "This message is no longer here."}</p>
        {subjectIsRemoved(subject) ? <AlreadyRemovedNote /> : null}
      </Card>
    );
  }
  if (subject.kind === "account_pair") {
    return (
      <Card>
        <p className={`${EYEBROW} text-text-muted`}>Accounts</p>
        <p className="mt-2 break-words text-sm text-text-primary">
          {subject.names[0]} and {subject.names[1]}
        </p>
      </Card>
    );
  }
  return <TradeSubjectCard subject={subject} />;
}

/** One side's traded players, valued at the moment the detector priced them. */
function TradedPlayerList({ label, players }: { readonly label: string; readonly players: readonly TradedPlayerView[] }) {
  return (
    <div>
      <p className="text-xs text-text-muted">{label}</p>
      {players.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted">Nothing named on this side.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {players.map((player) => (
            <li key={player.playerId} className="text-sm text-text-primary">
              {player.name}
              {player.position === null ? "" : ` (${player.position})`}, {player.averagePoints.toFixed(1)} points per week
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The trade arm of `FlagSubjectView`, in full — both teams, both sides valued, when it was
 * accepted, whether an operator already reversed it, how those values were priced
 * (`valuationBasis`), and the number that actually raised this flag (`fairnessGapSummary`, fix
 * round 2, F3). Task 6 shipped this arm with the queue detail page still rendering only
 * `subject.tradeId` (its own review's LOW); this is the render Task 7 owes it, now that the flag
 * this page most needs to explain in full is a trade one.
 */
function TradeSubjectCard({ subject }: { readonly subject: Extract<FlagSubjectView, { readonly kind: "trade" }> }) {
  return (
    <Card>
      <p className={`${EYEBROW} text-text-muted`}>Trade</p>
      <p className="mt-1 text-sm text-text-primary">
        {subject.proposerTeamName} and {subject.counterpartyTeamName}
      </p>
      <p className="mt-1 text-xs text-text-muted">
        Accepted {subject.acceptedAt.length === 0 ? "at an unknown time" : formatWhen(subject.acceptedAt)}. {subject.valuationBasis}
      </p>
      <p className="mt-1 text-xs text-text-muted">{subject.fairnessGapSummary}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TradedPlayerList label={`${subject.proposerTeamName} sent`} players={subject.gave} />
        <TradedPlayerList label={`${subject.counterpartyTeamName} sent`} players={subject.got} />
      </div>
      {subject.reversedAt !== null ? (
        <p className="mt-3 text-sm text-text-muted">An operator already reversed this trade, on {formatWhen(subject.reversedAt)}.</p>
      ) : subject.playersMovedAgain ? (
        <p className="mt-3 text-sm text-text-muted">
          One of these players has been traded again since. This trade can no longer be put back automatically; close it with no action, or warn the
          member instead.
        </p>
      ) : null}
    </Card>
  );
}

/** `subject.gave`/`.got`, joined into the plain list the trade_reversed preview interpolates —
 *  no `Intl.ListFormat`/`describeAsset` machinery here (that lives in `@/league-service/trades`,
 *  a boundary this Server Component has no reason to cross for a hint); a comma-joined list of
 *  names reads fine for a preview an operator glances at before submitting. */
function playerNames(players: readonly TradedPlayerView[]): string {
  return players.length === 0 ? "nothing" : players.map((player) => player.name).join(", ");
}

/**
 * The static half of every notice a decision this flag's subject supports could send —
 * `renderNotice` (`@/integrity/notices`), called SERVER-SIDE and handed down as plain data, is
 * how the resolution form previews the exact notice without `src/admin-room/**` ever value-
 * importing `@/integrity` (the client boundary, `eslint.config.mjs`). `note`/`reason` are never
 * interpolated into either template's body (`notices.ts`'s own templates), so the placeholder
 * passed here is never rendered — only `leagueName` matters, and it is real.
 *
 * `content_removed`'s preview is subject-aware (Task 6): a `chat_message` subject's removal
 * sends `chat_message_removed`, not `review_removed` — two different sentences, and showing the
 * wrong one would preview a notice the member is never actually sent.
 *
 * `trade_reversed`'s preview (Task 7) is ALSO subject-aware, and unlike the two above it DOES
 * interpolate real values into its body — `counterpartyTeamName`/`gotBackSummary`/
 * `gaveBackSummary` are read straight off the flag's own trade subject, from the PROPOSER's own
 * side, so the preview an operator reads before submitting says the real teams and the real
 * players rather than a placeholder sentence. Only present when the subject actually is a trade.
 */
function noticePreviewsFor(leagueName: string, subject: FlagSubjectView): Readonly<Partial<Record<"warned_user" | "content_removed" | "trade_reversed", DecisionPreview>>> {
  const base = {
    warned_user: renderNotice("operator_warning", { leagueName, note: "" }),
    content_removed:
      subject.kind === "chat_message" ? renderNotice("chat_message_removed", { leagueName, reason: "" }) : renderNotice("review_removed", { reason: "" }),
  };
  if (subject.kind !== "trade") return base;
  return {
    ...base,
    trade_reversed: renderNotice("trade_reversed", {
      leagueName,
      counterpartyTeamName: subject.counterpartyTeamName,
      gotBackSummary: playerNames(subject.gave),
      gaveBackSummary: playerNames(subject.got),
      note: "",
    }),
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
        <blockquote className="border-l-2 border-line pl-3 text-sm italic text-text-muted">{`"${resolution.note}"`}</blockquote>
      )}
    </div>
  );
}

/**
 * `content_removed` is offered only when it can actually succeed. Two ways it cannot, and both
 * are filtered here rather than left for the service to refuse — this page's standing promise is
 * that an operator is never offered a decision that fails on submit:
 *
 *  1. The subject type has no remover wired (`contentRemovalIsWiredFor`, `@/integrity/flags` —
 *     one table, read by this page, by `resolveFlag`'s pre-transaction check and by
 *     `removeSubject`'s backstop, rather than three copies of the same list).
 *  2. The content is ALREADY removed (final review, MEDIUM 8). A member can report a tombstoned
 *     message, which opens a fresh flag on it; `removeChatMessageInTx`'s no-re-stamp guard then
 *     refuses with a 409 and a full rollback, leaving the flag permanently unresolvable by the
 *     decision this page had offered. The flag is NOT auto-resolved — a fresh report on removed
 *     content is a real question, and `warned_user` is a real answer to it.
 */
function decisionsFor(decisions: readonly ResolutionDecision[], subject: FlagSubjectView): readonly ResolutionDecision[] {
  return decisions.filter(
    (decision) => decision !== "content_removed" || (contentRemovalIsWiredFor(subject.kind) && !subjectIsRemoved(subject)),
  );
}

/**
 * Fix round 2, F4. For a trade subject, `evidence.giving`/`.receiving` are the SAME per-player
 * arrays `TradeSubjectCard`'s own `TradedPlayerList`s already render as names, positions and
 * points — the friendly version. Left in the raw Evidence `dl` below, they show up as an
 * unreadable `break-all` JSON string competing for the same 360px width as the key label, for
 * zero information the friendly card didn't already say better. Every OTHER evidence field
 * (`verdict`, `flags`, `givingValue`, `receivingValue`, `gap`, `threshold`, `basis`) has no
 * friendly-card twin and stays in the raw panel — this drops only the two duplicated keys, and
 * only for a trade subject; every other flag type's evidence is untouched.
 */
function nonDuplicatedEvidenceEntries(evidence: JsonObject, subject: FlagSubjectView): readonly (readonly [string, unknown])[] {
  const entries = Object.entries(evidence);
  if (subject.kind !== "trade") return entries;
  return entries.filter(([key]) => key !== "giving" && key !== "receiving");
}

/**
 * The detail page: `withAdmin`'s Server Component overload, then `flagDetail`, then render.
 * `flagDetail` returning `null` (a flag id that names nothing) is `notFound()` — the same
 * non-oracle discipline the gate itself holds to, so a guessed id and a real-but-inaccessible one
 * read identically.
 *
 * Renders no `TopBar` and no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx` supplies
 * both, once, for every page in this route group.
 *
 * Task 19: the ORDINARY-subject branch below renders two columns at `lg` — evidence left,
 * decision right — because that is the read/decide split every one of those subjects shares. The
 * `held_trade` branch above it keeps its own whole-surface dispatch to `HeldTradeDetail` exactly
 * as it was (Task 5's own brief: "shows what the operator needs and nothing else"); a held trade
 * is not this same evidence-then-decision shape, and splitting it into two columns here would be
 * inventing a layout for a surface that already has its own. Not one authorization check moves:
 * `withAdmin` still gates the whole callback, `decisionsFor`'s two filters (removal not wired,
 * content already removed) are untouched, and `admin-routes.test.ts` — the tripwire this task
 * does not edit — stays the proof of it.
 */
export default async function AdminFlagDetailPage({ params }: PageProps) {
  const { flagId } = await params;

  return withAdmin(async () => {
    const detail = await flagDetail(getDb(), flagId);
    if (detail === null) notFound();

    // `held_trade` (Plan D, Task 5) is its own whole surface — `held-trade-detail.tsx` shows
    // what the operator needs and nothing else, never the generic Evidence/Reporters cards every
    // OTHER flag type gets (a held trade has no reporters, and its evidence is already the
    // friendly card in full). Dispatched before any of the generic-subject machinery below runs.
    if (detail.subject.kind === "held_trade") {
      const heldSubject: HeldTradeSubject = detail.subject;
      return (
        <>
          <header className="flex flex-col gap-1">
            <PageTitle>Held trade</PageTitle>
            <time dateTime={detail.raisedAt} className="text-sm text-text-muted">
              Held {formatWhen(detail.raisedAt)}
            </time>
          </header>
          {detail.resolution !== null ? (
            <Card>
              <p className={`mb-3 ${EYEBROW} text-text-muted`}>Decision</p>
              <ResolutionSummary resolution={detail.resolution} />
            </Card>
          ) : (
            <HeldTradeDetail
              flagId={detail.flagId}
              subject={heldSubject}
              trail={detail.trail}
              // The SAME offered set every other subject's form reads (final review F4) — this
              // surface renders its two buttons out of it rather than assuming both are live.
              decisions={detail.decisions}
              noteMaxLength={INTEGRITY_CONFIG.moderation.noteMaxLength}
            />
          )}
        </>
      );
    }

    const subject: Exclude<FlagSubjectView, { readonly kind: "held_trade" }> = detail.subject;
    const leagueName = detail.leagueId === null ? "your league" : await leagueNameFor(getDb(), detail.leagueId);
    const previews = noticePreviewsFor(leagueName, subject);
    const decisions = decisionsFor(detail.decisions, subject);
    const evidenceEntries = nonDuplicatedEvidenceEntries(detail.evidence, subject);

    return (
      <>
        <header className="flex flex-col gap-1">
          <PageTitle>Flag detail</PageTitle>
          <time dateTime={detail.raisedAt} className="text-sm text-text-muted">
            Raised {formatWhen(detail.raisedAt)}
          </time>
        </header>

        {/*
         * Task 19: two columns at `lg` and above, one below it. Left, the evidence a decision is
         * made from — the subject card, the raw evidence list, the reporters, the trail. Right,
         * the decision itself, `lg:sticky` so it stays reachable while an operator scrolls a long
         * trail without losing the form they are about to submit. `lg:items-start` is required
         * for the sticky column to work at all: a grid track's default `stretch` alignment would
         * make the decision column as tall as its own content wants, but a sticky element needs
         * its OWN box shorter than the viewport to have room to move within, and `items-start`
         * is what keeps the track from stretching to match the (usually taller) evidence column.
         * Nothing here changes what is rendered, only where — every card, every prop, every
         * decision this page offers is exactly what it was.
         */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <SubjectCard subject={subject} />

            <Card>
              <p className={`${EYEBROW} text-text-muted`}>Evidence</p>
              {evidenceEntries.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">No evidence recorded for this flag.</p>
              ) : (
                /* GAMEDAY, LAWS 1 AND 4, SPENT AS SPARINGLY AS THE OPERATOR RULING ASKS. The
                   keys stay verbatim and every value stays `JSON.stringify`d — an evidence dump's
                   whole worth is that it is the record, not a translation of it, and a per-key
                   label table would be this page deciding which machine facts an operator is
                   allowed to read. What changes is the register: values render mono, which is the
                   product's own face for a machine value and (via `globals.css`) carries
                   `tabular-nums`, so a gap of 20.89 and a threshold of 20 line up on the decimal
                   an operator is comparing them at. Rows are hairline-separated and tight rather
                   than floating on a gap, because this is read down a column. */
                <dl className="mt-2 flex flex-col">
                  {evidenceEntries.map(([key, value]) => (
                    <div key={key} className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 text-sm">
                      <dt className="shrink-0 text-text-muted">{key}</dt>
                      <dd className="min-w-0 break-all text-right font-mono text-text-primary">{JSON.stringify(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </Card>

            <Card>
              <p className={`${EYEBROW} text-text-muted`}>Reporters</p>
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
              <p className={`${EYEBROW} text-text-muted`}>What happened</p>
              {detail.trail.length === 0 ? (
                <p className="mt-2 text-sm text-text-muted">No recorded history for this flag yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col" aria-label="Flag history">
                  {detail.trail.map((row) => (
                    <li key={row.eventId} className="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
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
          </div>

          <div className="lg:sticky lg:top-6">
            <Card>
              <p className={`mb-3 ${EYEBROW} text-text-muted`}>Decision</p>
              {detail.resolution !== null ? (
                <ResolutionSummary resolution={detail.resolution} />
              ) : (
                <ResolutionForm
                  flagId={detail.flagId}
                  decisions={decisions}
                  noteMaxLength={INTEGRITY_CONFIG.moderation.noteMaxLength}
                  previews={previews}
                  isChatSubject={subject.kind === "chat_message"}
                />
              )}
            </Card>
          </div>
        </div>
      </>
    );
  });
}

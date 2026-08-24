"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge, ErrorState, InfoTip } from "@/components/ui";
import { Icon } from "@/components/ui/icon";
import type { NoticeView } from "../contract";
import { useNotices } from "../hooks/use-notices";

/**
 * Mirrors `INTEGRITY_CONFIG.notices.inboxSize` (`@/integrity/config`) — duplicated rather than
 * imported because `@/integrity` is blocked from client room code outright (the client boundary
 * rule, `eslint.config.mjs`, `src/account-room/**` included): a notice's cap is a fact this
 * component STATES in words, never data it reads over the wire. `rendered-copy.test.tsx`'s own
 * `NoticeInbox` describe block sits outside that boundary and asserts these two numbers are the
 * same value, so a future change to one that forgets the other fails there rather than silently
 * drifting.
 */
export const NOTICE_INBOX_SIZE = 20;

function formatNoticeDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function NoticeRow({ notice }: { readonly notice: NoticeView }) {
  return (
    <li className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
      <p className="break-words font-medium text-text-primary">{notice.title}</p>
      <p className="break-words text-sm text-text-muted">
        {notice.body}
        {notice.noticeType === "draft_auto_picked" ? <InfoTip term="queue" className="ml-1" /> : null}
      </p>
      {/* `quote` is the ONE wire field split out of a notice's stored `context`: the
          AUTHOR-FACING PHRASE the stored reason maps to (`quoteFor` -> `removalPhraseFor`),
          never the stored token itself, laid out as a real quotation rather than folded into
          `body`'s own sentence (fix round 1, FIX 7). `break-words` because a notice body carries
          user content (a league name, a player name) that has no space in it to wrap at. */}
      {notice.quote === null ? null : (
        <blockquote className="break-words border-l-2 border-line pl-3 text-sm italic text-text-muted">{`"${notice.quote}"`}</blockquote>
      )}
      <time dateTime={notice.createdAt} className="text-xs text-text-muted">
        {formatNoticeDate(notice.createdAt)}
      </time>
    </li>
  );
}

/**
 * The header's inbox: a bounded, cursorless (ruling 22) list of the caller's OWN notices —
 * what the platform did to them, across every league they're in. The one place a notice
 * (Task 7's stored copy — ruling 12, never re-rendered from a template here) actually reaches a
 * person, beyond the per-league "What the platform did" band the activity page renders.
 *
 * A disclosure, not a `Modal`: the page behind it stays interactive, and at 360px the panel is
 * edge-to-edge (`inset-x-4`) rather than a fixed-width card a narrow viewport would clip — the
 * same reason it grows into an anchored card only from `sm:` up. `position: fixed`, not
 * `absolute`, so its placement never depends on where the trigger happens to sit in the header's
 * flex row.
 *
 * Click, never hover, and Escape closes — the same discipline `InfoTip` already uses, plus
 * `Modal`'s "hand focus back to the opener on close": a keyboard user who opened this never
 * loses their place when they dismiss it.
 */
export function NoticeInbox() {
  const { notices, unreadCount, status, error, refetch, markRead } = useNotices();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // The sibling-ref idiom `HomeBoard`'s `bodyRef` uses (`src/league-room/components/
  // home-board.tsx`): updated during RENDER, not inside an effect, so the mark-read effect
  // below can read today's `notices`/`markRead` without listing them as dependencies — refs
  // are not reactive, so this needs no exhaustive-deps escape hatch.
  const noticesRef = useRef(notices);
  noticesRef.current = notices;
  const markReadRef = useRef(markRead);
  markReadRef.current = markRead;

  const close = useCallback((): void => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Marks everything the panel shows as read, once per open — never re-running just because
  // `notices` changed while it stayed open, or a notice arriving live while the reader still
  // has the panel open would stamp itself read before they had a chance to see it announced.
  // A reopen with nothing new since the last open finds no unread ids left and sends nothing.
  useEffect(() => {
    if (!open || status !== "ready") return;
    const unreadIds = noticesRef.current.filter((notice) => notice.readAt === null).map((notice) => notice.id);
    if (unreadIds.length > 0) void markReadRef.current(unreadIds);
  }, [open, status]);

  return (
    <div className="flex flex-col">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unreadCount === 0 ? "Notices" : `Notices, ${unreadCount} unread`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="relative flex items-center justify-center rounded-md p-1.5 text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="inbox" />
        {unreadCount === 0 ? null : (
          <Badge tone="accent" className="absolute -right-1 -top-1 px-1">
            {unreadCount}
          </Badge>
        )}
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Notices"
          className="fixed inset-x-4 top-16 z-20 flex max-h-96 flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-surface-elevated p-4 shadow-card sm:inset-x-auto sm:right-4 sm:w-96"
        >
          {/* The inventory's own HIGH: `listNotices` (`@/integrity-service/notify`) has no cursor
              and caps at `NOTICE_INBOX_SIZE`, so a notice older than the cap is unreachable from
              anywhere. One honest sentence about the cap, always shown while the panel is open —
              not a scroll that quietly stops rather than saying why. */}
          <p className="text-xs text-text-muted">Your last {NOTICE_INBOX_SIZE} notices.</p>
          {status === "error" ? (
            <ErrorState
              title="We could not load your notices."
              description={error ?? undefined}
              action={
                <button type="button" className="text-accent underline" onClick={() => void refetch()}>
                  Try again
                </button>
              }
            />
          ) : notices.length === 0 ? (
            <p className="text-sm text-text-muted">Nothing here yet.</p>
          ) : (
            <ul className="flex flex-col">
              {notices.map((notice) => (
                <NoticeRow key={notice.id} notice={notice} />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

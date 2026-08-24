"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { onSessionLost } from "./session-watch";
import { SignInLink } from "./sign-in-link";

type NoticeState = "quiet" | "strip" | "modal";

/** `"default"` is `TopBar`'s own bordered quiet-strip. `"room"` (Phase 3.6, Task 12 Step 1b, an
 *  A16 persona-panel finding parked here) is for the draft room's own tight `RoomRail` band,
 *  where this component was reusing `TopBar`'s bordered markup verbatim beside
 *  `ConnectionBanner`'s borderless `Badge` pill — two status idioms in one row. `"room"` reads as
 *  `ConnectionBanner`'s sibling instead: the same borderless pill, inline. Neither the copy nor
 *  the escalation behavior below changes with this prop — only the quiet strip's own shape. */
export type SessionNoticeVariant = "default" | "room";

/**
 * The session strip and the escalation, PLACED BY CHROME rather than owned by any one page
 * (F13): `TopBar` renders this under `AppShell`, above the content column; `RoomRail` renders it
 * (`variant="room"`) in the draft room's own banner slot beside `ConnectionBanner`; `PublicBar`
 * never — a signed-out visitor cannot lose a session they do not have.
 *
 * Listens once, through `onSessionLost` (`./session-watch.ts`), and escalates deliberately:
 *
 * - A BACKGROUND READ failing (the notices poll, a score refresh) renders the quiet strip. It
 *   does not steal focus, does not trap a keyboard, and does not interrupt somebody mid-sentence
 *   in league chat.
 * - A USER-INITIATED WRITE failing escalates to a `Modal`, because the person just tried to do
 *   something and it did not happen, and telling them quietly would be telling them nothing.
 *
 * It never says the work was saved, and it never claims it was lost when that is not known. The
 * one sentence it is allowed about state is the true one: "Nothing you typed was sent." Closing
 * the modal returns to the quiet strip rather than hiding the fact entirely — the session is
 * still gone, and this component does not un-know that because somebody dismissed a dialog. The
 * modal itself is IDENTICAL regardless of `variant` — a write failing is the same emergency in
 * every slot this component renders into.
 */
export function SessionNotice({ variant = "default" }: { readonly variant?: SessionNoticeVariant }) {
  const pathname = usePathname();
  const [state, setState] = useState<NoticeState>("quiet");

  useEffect(() => onSessionLost((detail) => setState(detail.write ? "modal" : "strip")), []);

  if (state === "quiet") return null;

  // Not run through `safeReturnTo` (unlike every OTHER `SignInLink` caller, which handles
  // untrusted input): `usePathname()` is the router's own state for the page THIS component is
  // already mounted on, never a foreign string a visitor or a query param could shape — there is
  // no origin to smuggle through it. Do not copy this exemption to a caller whose intent comes
  // from anywhere else (a query string, a prop threaded from outside, stored state).
  const intent = pathname === "" ? null : pathname;

  if (state === "modal") {
    return (
      <Modal open title="That did not go through" onClose={() => setState("strip")}>
        <p>Your session ended before this reached us. Nothing you typed was sent.</p>
        <p className="mt-2">
          <SignInLink intent={intent}>Sign in to pick up where you left off</SignInLink>
        </p>
      </Modal>
    );
  }

  if (variant === "room") {
    // `ConnectionBanner`'s own sibling shape: borderless, a `Badge` pill for the state, inline
    // rather than a full-width bordered band — the room's rail has no room to spare for a
    // second bordered strip beside its own. Same copy, same `role="status"`, same link.
    return (
      <span role="status" className="inline-flex items-center gap-2 text-sm text-text-muted">
        <Badge tone="warning">You are signed out.</Badge>
        <SignInLink intent={intent} className="font-medium text-accent underline">
          Sign in to pick up where you left off
        </SignInLink>
      </span>
    );
  }

  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-surface-elevated px-4 py-2 text-sm text-text-muted">
      <span>You are signed out.</span>
      <SignInLink intent={intent} className="font-medium text-accent underline">
        Sign in to pick up where you left off
      </SignInLink>
    </div>
  );
}

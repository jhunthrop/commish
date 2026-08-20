"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { HelpLevel } from "@/identity/preferences";
import type { InvitePreviewBody, JoinBody } from "../contract";
import { Button, ErrorState, Skeleton } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";
import { LeagueTermsPanel } from "./league-terms-panel";

type PreviewState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly reason: string }
  | { readonly status: "ready"; readonly terms: InvitePreviewBody };

/**
 * The landing page for a shared invite link. It names what it is asking somebody to agree to
 * (`LeagueTermsPanel`, fed by `GET /api/invites/[code]`) before it asks them to agree to it —
 * the invite used to say only "You've been invited to a league. Invite code ABC123."
 *
 * The preview fetch and the accept POST are two separate requests: a dead or expired code fails
 * the FIRST one, and there is nothing left to render but the same refusal `acceptInvite` would
 * have given anyway — no button, no code, no dead end, just a way back to `/app`.
 *
 * `signedIn` is the `PublicLeagueList` idiom: the terms are the same for everybody, and the only
 * thing an account changes is whether the action is "Join <league>" or "Sign in to join". The
 * preview fetch itself needs no session — that is the whole point of the route being
 * unauthenticated (see its own docblock and `middleware.ts`'s exemption).
 */
export function JoinForm({
  code,
  helpLevel,
  signedIn = true,
}: {
  readonly code: string;
  readonly helpLevel?: HelpLevel;
  readonly signedIn?: boolean;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview({ status: "loading" });

    (async (): Promise<void> => {
      try {
        const response = await fetchJson(`/api/invites/${code}`);
        const body = (await response.json()) as ApiEnvelope<InvitePreviewBody>;
        if (cancelled) return;
        setPreview(body.ok ? { status: "ready", terms: body.data } : { status: "error", reason: body.error });
      } catch {
        if (!cancelled) {
          setPreview({ status: "error", reason: "We couldn't reach the server. Check your connection and try again." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, fetchJson]);

  const join = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/invites/${code}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as ApiEnvelope<JoinBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/leagues/${body.data.leagueId}`);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (preview.status === "loading") {
    return <Skeleton lines={5} />;
  }

  if (preview.status === "error") {
    return (
      <ErrorState
        title="We couldn't open that invite"
        description={preview.reason}
        action={
          <Link href="/app" className="text-sm font-medium text-accent underline">
            Back to Commish
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* First-timer persona review, fix round 1: nothing anywhere in the invite flow said what
          JOINING MEANS. Lives here, not in `LeagueTermsPanel` — that component also renders
          post-join inside the league itself (Task 8), where this sentence would be stale and
          confusing (you already ARE in the draft and season). */}
      <p className="text-sm text-text-muted">
        {"Joining puts you in the draft and the season that follows. You'll set a lineup every week."}
      </p>
      <LeagueTermsPanel terms={preview.terms} helpLevel={helpLevel} />
      {signedIn ? (
        <Button onClick={() => void join()} loading={submitting} disabled={submitting}>
          {`Join ${preview.terms.name}`}
        </Button>
      ) : (
        <Link
          href="/sign-in"
          aria-label={`Sign in to join ${preview.terms.name}`}
          className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Sign in to join
        </Link>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

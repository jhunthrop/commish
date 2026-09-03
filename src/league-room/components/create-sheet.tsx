"use client";

import { useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import { BottomSheet, Button, ButtonLink, Input, buttonClassName } from "@/components/ui";
import { SegmentGroup } from "@/components/ui/segment-group";
import { MICRO_LABEL } from "@/components/ui/config";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { formatUsd } from "@/money/config";
import { defaultPodiumPrizeTable, prizePotCents } from "@/money/prize-table";
import { moneyIsLive } from "@/money/states";
import type { CreateLeagueBody, DraftScheduleBody, InviteBody } from "../contract";
import { useLeagueRoomDeps } from "../hooks/deps";
import { PRESETS, TEAM_COUNTS } from "./create-league-form";
import { moneySentence } from "./open-league-shared";

/**
 * What the server page threads down from `LEAGUE_CONFIG.defaults` — the client boundary bans a
 * `@/league` value import here, so THREADING the one constant is what "the sheet's defaults ARE
 * the service's, never a second copy" means on this side of the boundary. The POST body then
 * OMITS every field the visitor did not change from these, so `createLeagueSchema`'s own
 * defaults govern the write regardless.
 */
export interface CreateSheetDefaults {
  readonly teamCount: number;
  readonly scoringPreset: string;
  /** How many days out the service schedules a draft nobody names a night for. */
  readonly draftDaysFromCreation: number;
}

/** The live buy-in chips: free plus three fixed rungs. A custom amount stays a league-room
 *  concern — the sheet asks the question a crew argues about, not the whole fee schedule. */
const BUY_IN_CENTS = [0, 2500, 5000, 10000] as const;

const CONNECTION_FAILED = "We could not reach the server. Check your connection and try again.";

type CreatedState = {
  readonly leagueId: string;
  readonly inviteUrl: string | null;
  /** A create that landed but whose follow-up write (draft night, invite) refused — the league
   *  is real, the sheet says exactly what still needs the league room. */
  readonly followUpError: string | null;
};

/**
 * THE CREATE SHEET (front door blueprint, 2026-09-02): house rules pre-filled, and only the
 * questions a crew actually argues about — name, teams, scoring, buy-in (live money only),
 * draft night. Deep settings stay in the league room, and the sheet says so.
 *
 * NEVER A PARALLEL SYSTEM: the create is the existing `POST /api/leagues` (the schema's own
 * defaults fill everything unasked — invite-only visibility included, which is what a crew
 * league is); a chosen draft night writes through the existing `PUT
 * /api/leagues/[id]/draft-schedule`; the invite link is minted by the existing `POST
 * /api/leagues/[id]/invites` and IS the `/app/join/[code]` landing — the same join sheet body
 * the lobby uses. A paid crew league (live only) publishes `defaultPodiumPrizeTable`'s zero-rake
 * podium split, which `prizeTableInvariant` accepts by construction.
 *
 * Signed out, the sheet still shows the four questions (they are the pitch), and the one verb
 * is a `SignInLink` riding intent `/app#create-league` — choices do not pretend to survive the
 * trip through sign-in.
 */
export function CreateSheet({
  signedIn,
  defaults,
  live = moneyIsLive(),
  onClose,
}: {
  readonly signedIn: boolean;
  readonly defaults: CreateSheetDefaults;
  /** Defaults to the real `moneyIsLive()` — injectable, the `FrontDoorHero` idiom. */
  readonly live?: boolean;
  readonly onClose: () => void;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const [name, setName] = useState("");
  const [teamCount, setTeamCount] = useState(String(defaults.teamCount));
  const [scoringPreset, setScoringPreset] = useState(defaults.scoringPreset);
  const [buyInCents, setBuyInCents] = useState(0);
  const [draftNight, setDraftNight] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedState | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    const chosenNight = draftNight === "" ? null : new Date(draftNight);
    if (chosenNight !== null && Number.isNaN(chosenNight.getTime())) {
      setError("That draft night does not look like a valid time.");
      setSubmitting(false);
      return;
    }
    try {
      const paid = live && buyInCents > 0;
      const response = await fetchJson("/api/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          // Only what this sheet actually asks the founder: teamCount and scoringPreset. Every
          // other league setting is deliberately omitted, not forgotten — the LEAGUE_CONFIG
          // schema's own defaults govern whatever this sheet never asked about.
          teamCount: Number(teamCount),
          scoringPreset,
          // The zero-rake podium split, published with the fee it balances against — only a
          // live, paid create ever sends a money key at all.
          ...(paid
            ? { entryFeeCents: buyInCents, platformFeeCents: 0, payoutTable: defaultPodiumPrizeTable(buyInCents, Number(teamCount)) }
            : {}),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<CreateLeagueBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      const leagueId = body.data.leagueId;

      // The chosen night, through the EXISTING schedule write. A refusal here never unwinds the
      // create — the league is real; the sheet reports what still wants the league room.
      let followUpError: string | null = null;
      if (chosenNight !== null) {
        try {
          const scheduled = await fetchJson(`/api/leagues/${leagueId}/draft-schedule`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ kickoffAt: chosenNight.toISOString() }),
          });
          const scheduledBody = (await scheduled.json()) as ApiEnvelope<DraftScheduleBody>;
          if (!scheduledBody.ok) followUpError = scheduledBody.error;
        } catch {
          followUpError = CONNECTION_FAILED;
        }
      }

      // The invite link, minted through the EXISTING invites route.
      let inviteUrl: string | null = null;
      try {
        const invited = await fetchJson(`/api/leagues/${leagueId}/invites`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        const invitedBody = (await invited.json()) as ApiEnvelope<InviteBody>;
        if (invitedBody.ok) inviteUrl = invitedBody.data.url;
        else followUpError = followUpError ?? invitedBody.error;
      } catch {
        followUpError = followUpError ?? CONNECTION_FAILED;
      }

      setCreated({ leagueId, inviteUrl, followUpError });
    } catch {
      setError(CONNECTION_FAILED);
    } finally {
      setSubmitting(false);
    }
  };

  const copyInvite = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access refused (permissions, insecure context): the URL is on screen to
      // select by hand, so a failed convenience is not an error state.
    }
  };

  if (created !== null) {
    return (
      <BottomSheet label="Your league is live" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-bold leading-display text-text-primary">Your league is live</h2>
          {created.inviteUrl === null ? null : (
            <div className="flex flex-col gap-2">
              <p className={`${MICRO_LABEL} text-text-faint`}>What your crew sees</p>
              <p className="text-sm text-text-muted">
                One link, opening the same join sheet the lobby uses: your league&apos;s terms, the draft night, a seat to take.
              </p>
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line bg-surface-inset px-3 py-2">
                <span data-testid="invite-url" className="min-w-0 break-all font-mono text-sm tabular-nums text-text-muted">
                  {created.inviteUrl}
                </span>
                <Button variant="secondary" onClick={() => void copyInvite(created.inviteUrl!)}>
                  {copied ? "Copied" : "Copy invite link"}
                </Button>
              </div>
            </div>
          )}
          {created.followUpError === null ? null : (
            <p role="alert" className="text-sm text-negative">{created.followUpError}</p>
          )}
          {/* The one verb: into the room where the deep settings live. */}
          <ButtonLink href={`/app/leagues/${created.leagueId}`} variant="verb" className="w-fit">
            Open your league room
          </ButtonLink>
        </div>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet label="Start a league" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-xl font-bold leading-display text-text-primary">Start a league</h2>
          <p className="text-sm text-text-muted">house rules pre-filled · change what matters to your crew</p>
        </div>

        <Input label="League name" value={name} onChange={(event) => setName(event.target.value)} error={error ?? undefined} />

        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <SegmentGroup label="Teams" options={TEAM_COUNTS} value={teamCount} onChange={setTeamCount} />
          <SegmentGroup label="Scoring" options={PRESETS} value={scoringPreset} onChange={setScoringPreset} />
        </div>

        {live ? (
          <SegmentGroup
            label="Buy-in"
            options={BUY_IN_CENTS.map((cents) => ({ value: String(cents), label: cents === 0 ? "Free" : formatUsd(cents) }))}
            value={String(buyInCents)}
            onChange={(value) => setBuyInCents(Number(value))}
          />
        ) : (
          <p className="text-sm text-text-muted">{moneySentence(false)}</p>
        )}
        {live && buyInCents > 0 ? (
          <p className="text-sm text-text-muted">
            {`The pot is ${formatUsd(prizePotCents(defaultPodiumPrizeTable(buyInCents, Number(teamCount))))} at ${teamCount} paid seats, split across the podium. The exact split is published in your league room.`}
          </p>
        ) : null}

        <Input
          label="Draft night"
          type="datetime-local"
          value={draftNight}
          hint={`Your time. Leave it blank and the draft is scheduled ${defaults.draftDaysFromCreation} days out — change it any time in your league room.`}
          onChange={(event) => setDraftNight(event.target.value)}
        />

        <div className="grid gap-2.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-md bg-surface-inset p-3.5">
            <p className={`${MICRO_LABEL} text-text-faint`}>What you never do again</p>
            {live ? <p className="text-sm text-text-muted">Chase money: buy-ins land before the draft, nobody drafts unpaid.</p> : null}
            <p className="text-sm text-text-muted">Play referee: trade reviews run on deadlines, votes counted by the house.</p>
            <p className="text-sm text-text-muted">Run the machinery: the draft room, the schedule and the scoring are the house&apos;s job.</p>
            {live ? <p className="text-sm text-text-muted">Do payout math: the pot pays the podium when the season settles.</p> : null}
          </div>
          <div className="flex flex-col gap-1.5 rounded-md bg-surface-inset p-3.5">
            <p className={`${MICRO_LABEL} text-text-faint`}>What your crew sees</p>
            <p className="text-sm text-text-muted">
              One link, opening the same join sheet the lobby uses: your league&apos;s terms, the draft night, a seat to take. The
              link appears here the moment the league exists.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted">Deeper settings (rosters, waivers, draft format) live in your league room.</p>
          {signedIn ? (
            <Button type="submit" variant="verb" loading={submitting} disabled={submitting}>
              Create the league
            </Button>
          ) : (
            // Sign-in rides the verb; `/app#create-league` is the existing auth-gated create
            // surface, so a signed-in return lands somewhere that can actually create.
            <SignInLink intent="/app#create-league" className={buttonClassName("verb", "md")}>
              Sign in to start your league
            </SignInLink>
          )}
        </div>
      </form>
    </BottomSheet>
  );
}

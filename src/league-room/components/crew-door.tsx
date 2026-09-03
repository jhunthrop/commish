"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { moneyIsLive } from "@/money/states";
import { CreateSheet, type CreateSheetDefaults } from "./create-sheet";

/**
 * THE SECOND DOOR (front door blueprint, 2026-09-02, law 1): bring-your-crew is never hidden —
 * its own band directly under the shelf, OUTLINE verb (the solid amber belongs to the featured
 * row). Supersedes the Gameday closing band: a crew pitch at the page's foot was the old
 * "quietest thing on the page" defect wearing new copy, and the blueprint puts the door where a
 * commissioner scanning the shelf actually is.
 *
 * The pitch is "be the commissioner without the job" — and it DERIVES its automations from
 * `moneyIsLive()` rather than asserting the blueprint's money claims into a free season: today
 * the house runs the draft, the schedule, the scoring and referees trades on deadlines; once
 * money is live the sentence adds the buy-ins and the pot, which is when those become true.
 */
const FREE_PITCH =
  "Be the commissioner without the job. We run the draft, the schedule and the scoring, and referee trades on deadlines. You pick the format and the draft night.";
const LIVE_PITCH =
  "Be the commissioner without the job. We collect the buy-ins before the draft, referee trades on deadlines, and the pot pays the podium. You pick the format and the draft night.";

export function CrewDoor({
  signedIn,
  defaults,
  live = moneyIsLive(),
}: {
  readonly signedIn: boolean;
  readonly defaults: CreateSheetDefaults;
  /** Defaults to the real `moneyIsLive()` — injectable, the `FrontDoorHero` idiom. */
  readonly live?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex w-full flex-wrap items-center gap-x-6 gap-y-3 rounded-md border border-line bg-surface-elevated px-4 py-3.5">
      <h2 className="shrink-0 font-display text-md font-bold leading-display text-text-primary">Bringing your own crew?</h2>
      <p className="min-w-0 flex-1 basis-64 text-sm text-text-muted">{live ? LIVE_PITCH : FREE_PITCH}</p>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog" className="shrink-0">
        Start a league
      </Button>
      {open ? <CreateSheet signedIn={signedIn} defaults={defaults} live={live} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

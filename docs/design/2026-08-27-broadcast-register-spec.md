# Broadcast Register — Spec

**Status:** approved by the founder 2026-08-27. Plan: `docs/superpowers/plans/2026-08-27-broadcast-register.md`.
**Rendered form:** https://claude.ai/code/artifact/4f42cb37-6916-4baa-a46d-6a00f8524888

## The complaint

Founder, 2026-08-27, first: *"I like the cleanliness of the UI but it doesn't feel like 'fun' you
know?"* Then, more precisely: **"It feels like a legal website and not a fantasy site."**

That is an accurate diagnosis, and the cause is not sloppy execution. It is Sunday Standard v3 doing
exactly what it says.

## Why it reads as a contract

Four specific things, all of them deliberate design decisions that turned out to have a cost:

1. **We used the grammar of a document.** League facts render as `<dt>`/`<dd>` definition pairs —
   literally the markup of a contract. Hairlines instead of boxes. Uniform sentence case. One narrow
   band of grey.
2. **The copy is written like terms.** The clock said *"This team must make its pick before time runs
   out."* That is a compliance sentence. A fantasy product says "You're on the clock" and stops.
3. **There is almost no typographic dynamic range.** Sports interfaces live on roughly 10x scale
   contrast — a huge number, a tiny label. We were at about 2x. Uniform hierarchy is a document
   convention, and it is why the eye has nothing to grab.
4. **Nothing on screen belongs to anybody.** Twelve teams, twelve identical grey cells.

## The references, and what they actually do

The founder supplied FantasyPros and Flock. Read carefully, they are not "louder" — **Flock is darker
than we are** and still feels alive. What they have:

- A team-coloured block behind every player's face
- Saturated position badges
- A Draft button on **every** row, not one per screen
- "Your Pick!" as a loud solid moment
- Tier separators carrying letter grades
- A heat map on the data: green good, amber middling, red bad
- Team names that are jokes — half the fun is social and user-made

Three of our six rules forbid most of that. So the rules move, with scope.

## The amendments

**Rule 1 — colour is meaning.** Gains two meanings, product-wide: a **tier grade**, and a **team's own
colour behind a player's face**. Both are facts, not decoration. Green still means money; red still
means live; nothing else may claim either. Team colour lives only behind a face — never on a surface,
never on text.

**Rule 4 — hairlines, not boxes.** Bends for the **player pool row only**. A player is an object you
act on, not a line in a ledger. Panels, tables, standings and every surface outside the room keep
hairlines.

**Rule 5 — one ink action per view.** Bends **inside the draft room only**, where drafting *is* the
view. One button per screen made the primary verb the hardest thing on the page to find. Outside the
room the rule holds exactly as written, and `e2e/page-audit.spec.ts` keeps enforcing it on every
audited route — the carve-out is that the room is not in that route list, not that the assertion
weakens.

## The three that hold, and what they buy

**One typeface at ≤600**, **no caps**, and **only true things move**. Every ounce of the new energy
comes from colour, scale and shape. The type never had to shout, and nothing here invents motion: the
clock pulses because it is genuinely running out, the run callout counts real picks, and every steal
or reach is a real gap between board rank and pick slot.

Rule 6 is not merely preserved here — it is finally *used*. It always permitted motion on true things;
we simply never spent it.

## The single highest-value change

**The verdict chip.** "+11 steal" or "−3 reach" on a pick.

We already compute a pick's board rank at the moment it is made — it is the "RB4 on the board" in
today's results copy. The same number, framed as a verdict instead of a receipt, is the difference
between a room that records what you did and a room that tells you whether it was any good. It costs
no new data and no new honesty.

Ordering follows from that: **voice first** (cheapest, and roughly half the felt improvement), then
dynamic range, then the verdict chip, then the card row and per-row Draft.

## Parked

**Tier grade bands** need real tiers, which need the projection engine. The rule-1 amendment already
covers them, so no second ruling is needed when they arrive.

**Custom crests and team colours** are a Pro feature in the tiering matrix, not a room change.

## The test that matters

If a change makes the room louder without making a true thing more legible, it is decoration and rule
6 rejects it. The complaint was that the room reads as a contract — not that it lacks ornament.

# The Fun Pass — Site-Wide Design Spec

**Status:** approved by the founder 2026-08-27. Supersedes the draft-room-only draft of the same date.
**Program plan:** `docs/superpowers/plans/2026-08-27-fun-pass.md`
**Reference cut:** https://claude.ai/code/artifact/4f42cb37-6916-4baa-a46d-6a00f8524888 (the draft room, rendered in this register)

## The complaint

Founder, 2026-08-27: *"I like the cleanliness of the UI but it doesn't feel like 'fun' you know?"*
Then, precisely: **"It feels like a legal website and not a fantasy site."** And on scope, when an
earlier version of this spec narrowed to one screen: *"I wanted to reshape the entire site to be fun
like flock fantasy."*

**This is a site-wide reshape.** Every surface a manager touches, not the draft room alone.

## Why it reads as a contract

Four causes, all of them deliberate decisions that turned out to have a cost:

1. **We used the grammar of a document.** League facts render as `<dt>`/`<dd>` definition pairs —
   literally the markup of a contract. Hairlines instead of boxes, uniform sentence case, one narrow
   band of grey.
2. **The copy is written like terms.** *"This team must make its pick before time runs out."* is a
   compliance sentence. A fantasy product says "You're on the clock" and stops talking.
3. **Almost no typographic dynamic range.** Sports interfaces live on roughly 10x scale contrast — a
   huge number, a tiny label. We are at about 2x. Uniform hierarchy is a document convention, and it
   is why the eye has nothing to grab on any page.
4. **Every number is the same colour.** This is the big one, and the one the first draft of this spec
   missed.

## What Flock actually does

The founder's reference is darker than we are and still feels alive, which rules out "add light" as
the answer. What it has:

- **A heat map on the data.** Green good, amber middling, red bad — on every number, in every row.
  Nothing else in that screenshot does as much work.
- Letter-grade tier bands as coloured bars
- Saturated position badges
- Player faces everywhere
- An orange brand accent with a playful mark

And from FantasyPros: a team-coloured block behind every face, a Draft action on **every** row, "Your
Pick!" as a loud solid moment, and team names that are jokes — half the fun is social and user-made.

## The amendments

**Rule 1 — colour is meaning.** Gains **three** meanings, product-wide:

- **Magnitude.** A number may be coloured by where it falls in a real comparison set. This is the
  heat map, and it is the largest single change in this spec. It is only permitted where the
  comparison is genuine and stated — a percentile within a defined population, never a designer's
  feeling about whether 14.2 is a good number.
- **Tier grade.** S/A/B bands, once the projection engine makes tiers real.
- **Team identity.** A team's own colour, behind a player's face only. Never on a surface, never
  behind text.

Green still means money and red still means live. Magnitude reuses those hues deliberately — good is
green because good is the same feeling as money — but it may never appear on a control, which is what
keeps "green fill = action" intact.

**Rule 4 — hairlines, not boxes.** Amended product-wide with a stated test: **a thing you act on or
compare against its neighbours may be a card; a thing you read down a column stays a row.** Player
pool rows, league cards, matchup cards become cards. Standings tables, pick logs and rosters stay
hairline-separated rows, because scanning a column is what they are for.

**Rule 5 — one ink action per view.** Holds everywhere except surfaces whose entire purpose is
repeated action: the **draft room**, and later **waivers** and **trades**. Named exceptions, not a
general relaxation. `e2e/page-audit.spec.ts` keeps enforcing the rule on every audited route, and
those routes do not change.

## The three that hold

**One typeface at ≤600 weight**, **no caps**, **only true things move**. The weight cap holds; the
*size* range widens dramatically — dynamic range comes from scale, not from heavier type. And rule 6
is finally spent rather than merely obeyed: a clock pulses because it is running out, a score moves
because it changed, a run callout counts real picks.

## The colourblind problem, and the rule that follows

Green-versus-red is the worst available pair for deuteranopia, which affects roughly one in twelve
men — and this product's audience is overwhelmingly men. Flock's heat map fails this and we should
not copy the failure.

**Magnitude colour is never the only channel.** Every heat-coloured value carries a second encoding:
its own numeric value read plainly, and where a value is judged rather than reported, a weight step
or a small glyph. A manager who sees no colour at all must still get the ranking right.

## The single highest-value change

**The verdict chip.** "+11 steal" or "−3 reach" on a pick. We already compute a pick's board rank at
the moment it is made — it is the "RB4 on the board" in today's results copy. The same number, framed
as a verdict instead of a receipt, is the difference between a room that records what you did and a
room that tells you whether it was any good. No new data, no new honesty.

It is also the template for the whole pass: **we are almost never adding information. We are giving
information a shape that carries meaning.**

## Order of work, and why

1. **The language.** Magnitude tokens, the `Stat` primitive, the card primitive, the display type
   scale, the copy voice. Nothing screen-specific ships before the vocabulary exists, or every screen
   invents its own and we are back to five monogram rules.
2. **The draft room.** The hardest application, the flagship, and the best stress test of the
   language.
3. **The season surfaces** — matchups, standings, league home. Where a manager spends seventeen weeks
   and where magnitude colour pays off most.
4. **The storefront** — front door and browse. Where "fun" has to sell before anyone signs up.
5. **Mock drafts** — lobby and results.

## The test that matters

If a change makes a screen louder without making a true thing more legible, it is decoration and rule
6 rejects it. The complaint was that the product reads as a contract — not that it lacks ornament.

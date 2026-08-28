# Gameday — Commish Design System v4

**Status:** founder-directed 2026-08-28. **Replaces** Sunday Standard v3 (`docs/design-system.md`) rather than amending it.
**Rendered form:** https://claude.ai/code/artifact/8a73add3-9bdb-4878-b2a8-920137d0444f
**Scope:** the whole product. Founder: *"I want to do this for the whole site - not just these select pages."*

## Why v3 is being replaced, not amended

Sunday Standard was built on restraint, and restraint is a magazine's value system. It produced a calm, well-set document, and the founder's verdict on it was exact: *"It feels like a legal website and not a fantasy site."*

An earlier pass tried amending it — three rules bent, five phases, two agents, every change individually defensible. The result was *"little changes here and there"* rather than a step change, because **six rules that each forbid a thing cannot be patched into a system that affords one.** The failure was methodological as much as visual: a composition was decomposed into rule-gated increments and nobody owned the whole feeling.

## The six laws

Each replaces a v3 rule and is exactly as strict. They forbid different things.

**1. Colour is a legend.** Six channels, each with exactly one meaning: **money**, **live**, **magnitude**, **position**, **team**, **tier**. Nothing else carries pigment. A manager should read state without reading words.
*Replaces "colour is meaning" as scarcity, which left every screen grey and forced you to read everything.*

**2. The number is the hero.** One typeface, 7.6x scale range. A score is 84px; its label is 11px. Digits tabular everywhere. If the largest thing on a screen is not a number or a name, the screen is wrong.
*Replaces hierarchy-from-weight capped at 600, which produced a 2x range and nothing for the eye to hold.*

**3. A player is an object.** Face, team colour, position, number — every surface showing a player shows all four. Players, matchups and leagues are things you act on, drawn as things.
*Replaces "hairlines, not boxes", which rendered every object as a line of text.*

**4. Density is respect.** A manager on Sunday wants more true facts per screen, not fewer. Tight leading, real tables, no decorative whitespace. Space separates kinds of information; it never exists to calm.
*New. v3 had no density position, so every surface drifted airy.*

**5. The verb is obvious.** The action a screen exists for is the loudest thing on it, however many times it repeats.
*Replaces "one ink action per view", which hid the primary verb on exactly the screens built to repeat it.*

**6. Motion reports, never performs.** Nothing animates on mount, scroll or hover. Motion is permitted only where a real value changed, a real clock is running, or a real event arrived. Nothing eases longer than 250ms.
*Sharpens "only true things move" — right, never spent, and silent on the tacky failure modes.*

### The razor

**Turn every animation off. If the product feels dead, the aliveness was fake.** Aliveness is a property of the information: numbers that changed because the world changed, colour that encodes state, density of true facts, and the manager's own identity present on every screen.

## What survives from v3, unchanged

- **One typeface.** Geist only. Range from size, never a second family.
- **Sentence case in prose.** Uppercase survives only in mono micro-labels.
- **Every accessibility gate.** Contrast in both themes; magnitude never carried by hue alone.
- **Both themes.** Dark flagship, light designed to the same roles and thresholds.
- **Honesty.** No invented data, no tint without a stated population, no motion without a real event.

## What makes a screen feel like a sports app

From the Sunday build, and general to the product:

- **Answer "can I still win?", not only "am I winning?"** Yet-to-play, projected final, and per-player game state are what convert a score into a story. This is the fantasy-native tension and generic scoreboards omit it.
- **An event feed is the heartbeat.** A number that jumps with no explanation is unsettling; the same jump with "12 yd rushing TD" beside it is a moment.
- **A player who has not played reads as a dash and a kickoff time, never a zero.** Folding "has not played" into "scored nothing" is the most common lie a fantasy scoreboard tells.
- **State regret plainly** (bench points, missed waivers) because the manager is already computing it.
- **Heat against the population that shares the job**, so 4.2 reads as a bad afternoon rather than a number.

## Route inventory — every surface in scope

**Signed-in, the daily loop**
`/app` (leagues index — the landing screen, and the one an earlier pass missed entirely) · `/app/leagues/[id]` · `/app/leagues/[id]/matchups/[week]` · `/app/leagues/[id]/trades` · `/app/leagues/[id]/activity` · `/app/leagues`

**The rooms**
`/app/drafts/[draftId]` · `/draft/[draftId]/board` (the TV board — keeps its no-clickable-controls invariant and its own sizes) · `/app/mock-drafts` · `/app/mock-drafts/[code]` · `/app/join/[code]` · `/join/[leagueId]/hold`

**Self**
`/app/profile` · `/app/wallet`

**Storefront**
`/` · `/browse` · `/reviews` · `/league-rules` · `/support` · `/legal/terms` · `/legal/privacy` · `/sign-in/problem` · 404

**Operator** — `/app/admin/**` (7 pages). Gameday's tokens and primitives apply; its *drama* does not. An operator surface is a tool, and laws 2 and 6 are spent sparingly here.

## Execution doctrine

**The acceptance criterion is a screenshot, not a rule check.** Every screen track ends by rendering the real page, putting it beside this spec's intent, naming the differences and closing them. The previous pass verified tests, contrast ratios and rule compliance, and shipped surfaces nobody had ever looked at.

**Foundation first, then screens — but the foundation is proven by the mocks, not by unit tests alone.** Tokens and primitives are built directly from the two approved compositions so they are correct by construction rather than by argument.

**No screen ships alone.** A track owns a whole surface area and is judged on whether that area feels like one product.

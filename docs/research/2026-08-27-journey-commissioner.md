# Journey review: the commissioner ("Ana")

Date: 2026-08-27
Reviewer persona: **Ana, 35.** Runs her office's 12-team league every year. She picks the platform,
sets the rules, chases eleven coworkers to sign up, schedules the draft, and answers everyone's
questions. Her success metric is *"did I get eleven people signed up and drafted without forty text
messages."* She cares about creating a league with the settings she wants, inviting people
painlessly, seeing who has and has not joined, setting a draft time everyone can make, and not
being embarrassed by the product in front of her friends.

This is a **journey and navigation** review, not a screen-by-screen one. The six screen reviews
already exist in `docs/research/2026-08-2*`. What is judged here is the path *between* screens and
what falls through the cracks between them.

---

## Method

Read-only walk of the built app at `http://localhost:3102`, dark theme, driven by Playwright.
Desktop at 1440x900, plus a 390x844 pass for the parts Ana does on the go (chasing people while
standing in a kitchen). A real league was created, a real invite was minted, and a real second
identity opened that invite in a separate browser context and joined. No seeded league was touched.

Artifacts: `personaC-*.png` and `personaC-*.mjs` under the session scratchpad.

**Identities**
- Ana = `e2e/.auth/manager-a.json`
- Her coworker = `e2e/.auth/manager-b.json` (separate browser context)
- A logged-out context, to see the invite as a stranger with no account

**League created for this walk** (Ana's own, nothing seeded)
`Ana's Office League` — `5cf17930-e402-4494-8bf6-9f0c49a3c0a0` — 12 teams, snake, PPR, invite only.
Invite codes minted during the walk: `ZHSBJF2C`, then `MV6V9QZ6`.

### Click path, as walked

| # | Ana's goal | Path | Interactions |
|---|---|---|---|
| 1 | Start a league | `/app` → scroll 7,400px → `<details>` "Start or join another league" → `<summary>` "Advanced settings" → name → Teams → Scoring → **Create league** | 6 + a full-page scroll |
| 1b | (the shortcut she has to already know) | league rail `+` tile → `/app#create-league` (auto-opens) → Advanced → fill → Create | 4 |
| 2 | See what she made | auto-redirect to `/app/leagues/{id}` | 0 |
| 3 | Get the link | "Invite someone" → jumps to `#invite-managers` at y≈2,960 (desktop) / y≈4,196 (phone) → **Create invite link** | 2 |
| 4 | Share the link | select text in a read-only input, copy, **manually prepend `http://localhost:3102`**, paste into Messages | 0 in-product; 1 manual repair |
| 5 | Friend opens it | `/app/join/ZHSBJF2C` — renders logged-out, full league summary | 0 |
| 6 | Friend joins | **Join Ana's Office League** → seated, redirected to the league | 1 |
| 7 | Ana checks who is in | reload `/app/leagues/{id}` → read seat grid, or scroll to the Managers list at the bottom | 1 |
| 8 | Ana moves the draft | **Edit time** → `datetime-local` → **Save time** | 3 |
| 9 | Ana nudges the nine who have not joined | *no path exists* | — |

---

## The walk, narrated

**Creating the league.** Ana signs in and lands on `/app`. There is no "Create a league" anywhere in
the header, and no create screen in the app. The form lives inside a collapsed
`<details>` labelled *"Start or join another league"*, sitting at the very bottom of the home page —
below her league board and below the entire open-leagues shelf. Measured position of the
`#create-league` anchor on a populated account: **y = 7,612 in a 7,390px document**. The only
top-level affordance is a dashed `+` tile at the far end of the league rail, whose accessible name
is "Join or create another league" and which shows no text. A commissioner arriving to start a
league is, structurally, being shown other people's leagues first.

Once open, the form itself is genuinely good. Six visible controls, everything defaulted, plain
English throughout: *"Who can join: Invite only / Anyone can find and join"*, *"Scoring: PPR (a
point per catch)"*, *"Roster shape: Standard / Superflex"* with a "What is a superflex spot?"
button. Ana understands every choice she is making. This is the strongest part of her journey.

Two things undercut it. The Advanced disclosure's own summary line promises *"draft format, teams,
scoring, roster shape, **auction budget**, **draft start**, and stake tier"* — but on an invite-only
league neither auction budget nor draft start is rendered. Draft start only appears when she flips
visibility to public. So the one setting Ana came for — *when is the draft* — is advertised and then
absent. And the form never asks for her team name.

She types a name and presses Create. **~4s**, then a clean redirect straight into the league room.
Good.

**The league room.** Handsome and legible. A countdown hero, "2 of 12 seated", a seat grid of twelve
chips, "Invite someone", a waiting-room checklist, standings, chat, and a summary rail. The product
made her look good here.

The room also silently invented a draft time: **Thursday, September 3 at 11:38 AM** — exactly seven
days from the minute she pressed Create, ragged minute and all. Nothing asked her to confirm it.
If she never scrolls, she has scheduled her office draft for a Thursday morning.

The seat grid carries a chip reading **"Open to everyone"** on a league she explicitly set to
*Invite only*. That chip is the experience tier, but next to a seat grid it reads as the privacy
setting, and nowhere in the room does the word "private" or "invite only" appear. Ana has no
confirmation that her league is actually closed.

Below the grid, a section headed **"Name your team"** tells her *"Your team is named Commish Lab's
team. That is what the rest of the room will call you all season."* There is no input and no button.
`waiting-room.tsx`'s own docblock confirms it: no team-rename endpoint exists. In an office league,
team names are half the point.

**The invite.** She presses "Invite someone", which jumps her to the bottom of the page, and presses
**Create invite link**. What appears is a read-only input whose value is:

```
/app/join/ZHSBJF2C
```

A relative path. No copy button, no share sheet, no `mailto`. `invite-panel.tsx` states the omission
is deliberate — *"the read-only input is there so the link can be selected and copied with the
keyboard on every platform, rather than depending on a clipboard permission"* — but the string being
copied is not a link. Ana selects it, pastes it into a text message, and sends her coworkers
something that does not open. To make it work she has to know to type `http://localhost:3102` (in
production, the domain) in front of it. On a phone, where this job actually happens, she is doing
select-all inside a 324px read-only input at **y ≈ 4,196 of a 4,493px page** — the last thing above
the footer.

The helper line reads *"Good for up to 32 people, until 9/10/2026."* Thirty-two people for a
twelve-team league, and a US numeric date on a screen whose neighbours all say "Thursday 3
September".

Then she closes the tab. On reload the panel shows **"Create invite link"** again — the invite she
already sent is gone from the UI. Pressing it a second time mints a *different* code (`MV6V9QZ6`).
The invites API is POST-only; there is no list endpoint, no revoke, no "your active link". Ana now
has two live codes for one league and no way to see either.

**What her friend sees.** This is the best screen in the journey. Logged out, on a phone, the invite
landing renders without an account: league name, format with a plain-English gloss, stake, size,
scoring, the full roster shape (`1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench`), the draft
date, and the commissioner's name. Then one button: **Join Ana's Office League**. Signed in, the
join takes ~5s and lands on a *"You're in — you claimed seat 2 of 12 just now"* banner. Nothing
about that flow will generate a text message.

Except the date. The landing says **"Thursday 3 September, 4:38 PM UTC"** — UTC, to a coworker in an
office.

**Ana comes back.** She reloads. She learns her coworker joined *only* by counting avatars: the
notices tray got nothing about a join (twenty notices, none from her league), and the seat grid has
no join order, no timestamps, and no "new" marker. The two seated chips both read "CL Commish Lab",
because nothing in the seat grid or the standings disambiguates two people who share a display
name — no email, no handle, no team-name fallback. (Both fixtures happen to carry the seed default
name, which is why the collision surfaced here; the product has no defence against it either way.)
The `/activity` feed *does* log *"Commish Lab joined the league"* with a timestamp, but it is a
separate page she has no reason to open.

**Scheduling.** "Edit time" opens a single native `datetime-local`, she picks Saturday 5 September
7:00 PM, presses "Save time", done in three interactions. Fast and clear — the best commissioner
control in the product.

And then the worst finding in the walk. After saving, **the same page shows the draft on two
different calendar days**:

- the hero: *"Saturday, September 5 at 7:00 PM (in 9 days)"* — her local time
- the summary rail, ~3,000px below it, and the invite landing every friend sees:
  *"Sunday 6 September, 12:00 AM UTC (in 9 days)"*

Same instant, two renderings, different weekday and different date. Her coworkers read the invite
page, see Sunday at midnight, and text her. There is also no record of the change: the activity feed
logs the create and the join but not the reschedule, and the coworker who already joined receives no
notice that the draft moved.

**Nobody joins.** Nine seats stay open. Ana has, in the product, exactly one lever: the amber line
*"10 seats are still open. Starting now drafts a short league."* There is no pending-invite list, no
resend, no reminder, no way to change the league from twelve teams to eight, no way to fill an empty
seat with a bot, and no way to remove a manager who joins and ghosts (`DELETE /seat` releases only
the caller's own seat, and refuses the commissioner outright). League chat reaches only the people
who already joined. Every remaining nudge happens in Messages.

**Mobile.** The room's top half is excellent on a 390px screen — the crest, the countdown, the
seated dots, "Edit time" and "Start the draft" all land above the fold and look premium. Everything
Ana does *on the go*, though, is at the bottom: the invite panel at y≈4,196, the Managers list just
above it. The chasing work is the mobile work, and it is the furthest thing from her thumb.

---

## Findings

| id | severity | what | where | one-line fix |
|---|---|---|---|---|
| C-01 | **BLOCKER** | The invite value is the relative path `/app/join/CODE`; pasted into a text it does not open | `src/league-room/components/invite-panel.tsx` (`value={invite.path}`) | Render the absolute URL, and add a Copy button plus `navigator.share` on touch |
| C-02 | **BLOCKER** | The same page shows the draft on two different days — hero in local time, summary rail and invite landing in UTC | `draft-schedule-panel.tsx` vs the league summary rail and `invite-landing.tsx` | One date formatter, viewer-local everywhere, with the zone abbreviation appended |
| C-03 | **BLOCKER** | The invite link vanishes on reload; pressing the button again mints a second live code; no list, no revoke | `invite-panel.tsx` (local `useState`), `api/leagues/[leagueId]/invites` is POST-only | Add `GET /invites`; show the active link on load; make the button "Replace link" once one exists |
| C-04 | FRICTION | No way to nudge: no pending-invite list, no reminder, no notice to Ana when someone joins | league room, notices tray | Emit a "someone joined" notice, and show "9 seats open — send the link again" with the link inline |
| C-05 | FRICTION | A manager who joins and ghosts cannot be removed; the commissioner cannot leave either | `api/leagues/[leagueId]/seat/route.ts` | Add a commissioner seat-release before the draft starts |
| C-06 | FRICTION | An invite-only league is labelled "Open to everyone" and never says "private" anywhere in the room | seat grid chip, league summary rail | Show the visibility as its own chip ("Invite only"); rename the tier chip to "Any experience" |
| C-07 | FRICTION | "Name your team" states the name and offers no control; owner gets "X's team", joiner gets bare "X" | `waiting-room.tsx` (no rename endpoint exists) | Ship `PATCH /teams/{id}` and put the input in the section that already promises it |
| C-08 | FRICTION | The create form is inside a collapsed `<details>` at the bottom of `/app` (anchor at y=7,612 on a populated account) | `start-or-join-disclosure.tsx`, `/app` | Put "Create a league" in the header, or give it its own route |
| C-09 | FRICTION | The Advanced summary promises "auction budget" and "draft start", neither of which renders on a private league | `create-league-form.tsx` `DRAWER_SUMMARY` | Make the summary list only the fields the current visibility actually shows |
| C-10 | FRICTION | The draft time is silently auto-set to creation-time + 7 days, ragged minute and all ("11:38 AM"), with nothing asking her to confirm | `createLeague` default | Ask for a draft date in the create form, or default to the next Saturday 7:00 PM and surface it as "Confirm draft time" |
| C-11 | FRICTION | The invite panel is the last thing on the page — y≈4,196 of 4,493 on a phone | league room order | Promote the invite panel next to the seat grid whenever seats are open |
| C-12 | FRICTION | "Good for up to 32 people" on a 12-team league | `invite-panel.tsx` | Cap `maxUses` at the open-seat count, and say "Good for the 10 open seats" |
| C-13 | FRICTION | Members get no countdown and no seat grid; the draft date reaches them only in the summary rail at the bottom | league room, member branch | Show every member the same countdown hero, controls omitted |
| C-14 | FRICTION | Rescheduling the draft writes no activity entry and sends no notice to anyone already seated | `PUT /draft-schedule` | Log the reschedule and notify seated managers with the old and new time |
| C-15 | POLISH | Countdown reads `223:18:11` — raw hours for a 9-day horizon | `draft-schedule-panel.tsx` | Show days and hours past 48h; keep the second-by-second clock for the last day |
| C-16 | POLISH | Three date formats in one journey: "Thursday 3 September", "Saturday, September 5", "9/10/2026" | invite landing, hero, invite helper | One shared formatter |
| C-17 | POLISH | Two managers with the same display name are indistinguishable in the seat grid and the standings | seat grid, standings, Managers list | Fall back to team name, then a short handle or masked email, on collision |
| C-18 | POLISH | At "More help", the inline glossary text collides with the value it explains in the summary rail | league summary rail | Give the help text its own row instead of trailing the value |
| C-19 | POLISH | The only header-level create affordance is an icon-only `+` at the far end of the league rail | `league-rail.tsx` | Label it, and pin it to the start of the rail |
| C-20 | POLISH | Pre-draft standings list every team at 0-0 / 0.00 / 0.00 | league room | Hide standings until the draft completes |

**Counts — 3 BLOCKER, 11 FRICTION, 6 POLISH.**

---

## The texts she still has to send

Every one of these is a message the product could have absorbed and did not.

1. *"Ignore that last link, it doesn't work — try commish.com/app/join/ZHSBJF2C"* — to eleven people,
   because what she copied was a relative path (C-01).
2. *"It's Saturday the 5th at 7, not Sunday"* — to everyone who read the invite page, which renders
   UTC (C-02).
3. *"Wait, I sent two different codes, use the second one"* — because the first link disappeared on
   reload and she pressed the button again (C-03).
4. *"Did you join yet?"* — to each of nine people individually, forever, because nothing tells her
   who is outstanding and there is no reminder (C-04).
5. *"I moved the draft to Saturday"* — manually, to everyone already in, because the reschedule
   notifies nobody (C-14).
6. *"Which one of these two 'Commish Lab' is you?"* (C-17).
7. *"You can't rename your team yet, sorry"* — the single most predictable reply in an office league
   (C-07).
8. *"Yes it's private, ignore the bit that says open to everyone"* (C-06).
9. *"Sam bailed, I can't take him out, we're just drafting short"* (C-05).

Net: the product removes the *joining* texts — that invite landing is genuinely good, and a stranger
needs no explanation from Ana to understand what she has invited them into. It adds back an equal
number of *correction* texts, all of them created after the invite leaves the app.

---

## The three changes that would most reduce her work

**1. Make the invite a real, durable, one-tap artifact.**
Absolute URL, a Copy button, `navigator.share` on touch, the active link shown on every page load
(`GET /invites`), and the panel sitting beside the seat grid instead of below the footer. This is
C-01 + C-03 + C-11 as one change, and it is the difference between "share" and "share, then apologise,
then re-share". It alone removes texts 1 and 3.

**2. One clock, everywhere, in the viewer's own time zone — and announce every change to it.**
The draft time is the single fact Ana's whole job orbits, and today it renders as two different
calendar days on one screen and as UTC on the page her friends read. Route every draft timestamp
through one formatter, always viewer-local with a zone label, log reschedules to the activity feed,
and notify seated managers when it moves. C-02 + C-14 + C-16. Removes texts 2 and 5.

**3. Give her a roster she can act on.**
"9 of 12 seats open" should be a thing she can *do* something with, not a number she reads: the live
invite link inline, a notice when someone joins, join timestamps on the seat chips, disambiguated
names, and the ability to release a seat someone has abandoned. C-04 + C-05 + C-17. Removes text 4 —
the one she sends most.

---

## Could she run her league end to end today?

**Almost — but not without leaving the product.** Everything mechanical works: the league is created
in under a minute, the settings are legible, the invite landing is excellent, joining is one tap,
the seat fills correctly, and rescheduling the draft takes three interactions and is instant. She
could get eleven people in and reach a draft.

She cannot do it *without the forty texts*, which is her actual success metric. The invite she is
handed is not a working link, so the first send fails for everyone; the draft time she sets is shown
to her friends as a different day; and she has no in-product way to see who is missing or to chase
them. The journey is sound and the screens are handsome — the breakage is entirely in the seams
between the app and the group chat, which is exactly where a commissioner lives.

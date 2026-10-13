# The mock room, rethought for a prep site

Date 2026-10-12. Status: design authority for the mock room on the prep site, decided under the founder's autonomy grant of 2026-10-11 and the two directions below. Mocks: `docs/design/mocks/2026-10-12-commish/{setup,mock,lobby,report}.html`, and the artifact linked from the ledger.

## The founder's words

"We also need to rethink the mock draft room. It should be rebuilt to be as efficient as possible for mock drafts since users won't actually be drafting in our tool."

"We could have mock drafts with real participants. FantasyPros has this."

## The thesis

Nobody drafts for real in our tool. A mock on a prep site is an experiment, not an event: the drafter wants to know what a team from slot 8 in a 12-team PPR league looks like, what happens if they go a different way at 3.08, and who they end up with over many tries. The room that served league drafts was built around a clock and a reveal, because a league draft is a night out. A mock room is built around the loop: set it up once, run it in minutes, read the report, run it again.

So there are two rooms on one surface, and the clock exists in only one of them.

| | Solo, against bots | Lobby, with people |
|---|---|---|
| Clock | None. The bots have already picked when the page paints. | 30 or 45 seconds a pick, chosen by the lobby format. |
| Pace | As long as your own picks take. Enter drafts our call. | Twelve drafters, about 15 minutes. |
| Reveal | None. What went since your last pick lands as one strip. | Picks land as they are made. |
| Undo, branch, replay | Yes. The mock is a function of settings, seed and your picks. | No. It is other people's draft too. |
| Score bug | Never. | Yes. The one Broadcast borrowing that survives, because someone is on a clock. |
| Owner of time | The request. | A Go room process on Cloud Run. |

The market gap is real on both sides. FantasyPros removed live mocks with people in 2026 and it is one of the four complaint themes in its reviews (`docs/research/2026-10-11-prep-site-feature-burndown.md`). Flock has a queue for dynasty startups with about a three-minute wait and no projections. Neither explains a pick.

## The solo room: the mock is a function

`draft = run(settings, seed, yourPicks)`. Every bot pick is a seeded draw, so the same seed replays the same room. This is already how the engine works (see Engine facts), and it is what makes the room efficient:

- **No clock and no reveal.** On your pick, every bot pick until your next turn is resolved in one commit, as today, and stamped with no delay instead of a 450 to 950 ms think time. The client reveals everything at once. The measured round trip for the batch is 32 ms p50 in a 12-team room, so the next turn is on screen before the hand leaves the key.
- **What went since your pick.** The picks between your turns are one strip: the count, the faces in order, and anyone from your queue ringed in orange with "queued" under him. It replaces the ticker, the pacing message and the reveal animation. A drafter learns what the room did to them without scrolling the wall.
- **Our call, as a panel, not a lower third.** His face, the survival odds as the one big number, the runner-up in a sentence that states both odds ("Prescott has more over replacement at +22.2 and is still there at 6.05 97% of the time. Williams is there under 1% of the time."; the product never says "is not" when the odds are only lower, ruling 2026-10-14 after the rooms design review), and the verb with its key. A Press Box panel with an orange edge above the pool, so nothing covers the rows. The lower third from the Broadcast direction is retired.
- **The pool** ranked by points over replacement with the survival odds to your next pick on every row, the ADP sentence ("drafters take him 22 later"), Queue and Draft on each row, position chips and a Queue chip.
- **Undo** any of your picks. The draft is truncated to that pick and replays from there with the same seed, so the bots behave the same up to the change and the room shows the branch. Later picks cannot stand, because a removed pick changes the pool (ruling 2026-10-13, after the Go port). **Pick for me to round N** and **Finish the draft** autopick from your queue first, then your sheet, then the board. **Save and share** gives a link that carries the seed and your picks, so anyone opens the same draft.
- **Keyboard.** Enter drafts our call, arrows move through the pool, Q queues, U undoes, / searches. Listed in the dock, not as a tip: the keys panel is the control, the way a menu shows its shortcuts.
- **Your team by slot** in the dock, open starters marked, with one sentence on what is still open. The board already weighs roster need in the call, so the sentence says that instead of advising.

## The report

The end of a mock is the product, so it gets a page, not a modal.

- **One big number:** projected points from your starters, your rank among the twelve, the next team's number. The first paragraph names the basis: points are our projections, the same numbers the board ranks by, so a team drafted off the board should lead the table. The useful read is how far ahead and where it came from. No letter grade. The old `gradeDraft` letter (room-relative quartiles) is dropped. Its `projectedPoints` and `projectedRank` stay.
- **The field:** the twelve teams as bars.
- **Pick by pick:** every pick of yours with points over replacement, the ADP gap as a chip (rose "12 before drafters" for a reach, green "3 after drafters" for a steal, grey "at ADP" inside three picks) and hindsight: the chance he was still there at your next turn, as the room said at that pick (the odds table recorded with the pick; the engine's sim only when a pick carries none). "Could wait" starts at 60%.
- **The same draft, 200 more times:** your picks on autopick from the board, the bots reshuffled each run. A histogram of starting points with the median marked, the middle 80%, the share of runs that finish top three, the rank counts, and in the dock who you end up with as a share of runs. This is the room's own 200-run sim (`src/draft-service/sim/room-odds.ts`, about 250 ms for 200 runs) started from pick one instead of the current pick. In the mock built today, bots pick from ADP blurred by the survival spread, which puts the drafter first in 174 of 200 runs. The real bots reach and chase positions, which widens the band, and the page must keep naming the basis either way.
- **Verbs:** Run it again from slot 8, Try another slot, Save this draft as a sheet, Copy a share link.

## The lobby: people, and a clock

- **Queue by format**, not by room: 12 PPR, 12 half PPR superflex, 10 PPR. The setup page shows what is filling ("7 of 12"). A lobby starts when it is full or 90 seconds after the first drafter joins, with bots in the open seats. Today's fill window is 180 seconds with a 10 second grace; 90 is the number to measure against, since Flock's three-minute wait is the complaint we can beat.
- **30 seconds a pick** in the default lobbies, 45 in the ten-team one. On expiry the seat's queue drafts, then its sheet, then the board. A seat that closes the tab is replaced by a bot at once, not autopicked forever, so a room never dies from one leaver. Reconnect is by room id and sequence.
- **The score bug** carries round and pick, who is on the clock, the clock, and your pick with how many picks away. The seats strip under it shows each seat as a drafter, a bot, on the clock, or left with its queue drafting. You are the orange seat.
- **Picks as they land.** Under the seats, the last round of picks newest first, each with the face, the name, who took him (a handle or a bot) and the pick number, the newest ringed. In a room with people, what others are taking is the room, so it sits above the call and the pool, and the wall stays below for the full picture. The founder asked for this on 2026-10-12 after the first mock put the wall under the pool.
- **Our call** in a lobby is conditional: "If the board holds to 5.08, take Tyler Warren", with the odds he reaches your pick, and the verb is Queue him first, because you are not on the clock.
- **No chat at launch.** Handles only, moderated by the account layer. Reactions can come later.
- **Human mocks are data.** Every lobby pick is a drafter's pick, which is the start of our own ADP ("where Commish drafters take him") and a public check on the bots. The nightly job reads the lobby log.

## Setup

One screen, saved as a league so a rerun is one tap: scoring preset (PPR, half, standard, TE premium) and custom scoring imported from ESPN, Yahoo or Sleeper behind the Draft Pass; teams 8 to 14; your slot or random; the roster as counts with the round count derived from them; lineup standard, superflex or two flex; how the bots draft (from where drafters take players now, from your league's last draft once an import exists); keepers. Start against bots is the verb, Join a lobby with people is the quiet one beside it, and the lobbies filling now sit in the dock.

## Engine facts the design stands on

From a read of the code on 2026-10-12, no code run:

- The reducer `reduceDraft` (`src/draft-engine/reduce.ts:68`) is pure and carries no clock. Every action has its own timestamp. `replayDraft` (`src/draft-engine/replay.ts`) rebuilds state from the action log.
- Bots are deterministic given a seed: mulberry32 with FNV-1a keying (`src/mock-draft/rng.ts`), one stream per team, seven archetypes dealt by a seeded shuffle. `chooseBotPick` (`src/mock-draft/bots.ts:215`) draws once from the top eight legal candidates weighted by rank, archetype bias, roster need and runs.
- Replay pins (`src/draft-engine/replay-pins.fixture.ts`) fix 60 bot picks, 24 delays and 60 clock autopicks for seed 20260912, a byte-for-byte oracle for a port.
- The batch already exists: `appendBotPicks` (`src/draft-service/store.ts:456`) resolves every bot pick until a human is on the clock inside the human's own transaction. The reveal delay is one line (`src/mock-draft-service/driver.ts:256`, `MOCK_CONFIG.botDelay`). The only guard to respect: stamps must stay monotone, because `admitMakePick` refuses a pick stamped before `turnStartedAt`.
- The 200-run sim `simulateRoomOdds` (`src/draft-service/sim/room-odds.ts:89`) continues the real room with the real reducer and bot sampler, about 250 ms for 200 runs on Apple silicon, 587 ms on Vercel.
- The closed-form survival (`src/projections/decide/survival.ts`) feeds `recommendPick`. The advisor (`src/draft-service/assistant/advisor.ts:106`) returns the pick, its make-it-back odds, a why of at most two sentences, candidates and tiers.
- Post-draft grading exists (`src/draft-service/grades/engine.ts:177`): value captured, projected points, starters filled, bye collisions, a letter, projected rank.
- What does not exist: autopick from a whole sheet (only the top five seed the queue), a queue-based lobby, a process that owns a human room's clock (expiry runs on a one-minute cron or on the next read), undo or branching, a share link, a standings or season projection beyond projected rank.
- Sizes for the port budget: draft engine 3,014 lines, bots 781, advisor 1,235, sims 1,667, decide layer 2,276, mock room service 1,784, room UI 13,006.

## Where it runs

- **Go on Cloud Run owns every room.** A lobby needs a process that holds the clock, and a solo mock is the same reducer without a clock, so one engine serves both. The draft engine, the bots and the continue/room-odds sim are ported to Go before launch, with the replay pins and a frozen 1,000-run sim fixture as the oracles. The TypeScript advisor, the closed-form survival and the why text stay as the TypeScript lane behind an internal endpoint at launch, ported after. The projections fit is never ported.
- **One goroutine per live room**, WebSocket to the client with session affinity, state as an action log in Postgres on Neon with the same semantics as `draft_actions`, minimum one instance during draft season so a clock never waits on a cold start, and a sweep for the case where an instance dies mid-room.
- **The client is SvelteKit**, client-rendered for the room and the report, with the reveal queue, the ticker, the pacing message and the self-wake machinery gone. The mock and the report are one route with a seed and a pick list in the URL.
- **Measurement before build:** fill time in a lobby (target under 90 seconds), pick round trip in a solo room (target under 50 ms p90 including the batch), report time (the 200 runs under 300 ms), and reconnect time after a tab close.

## What the build must settle

1. Tiers in the data are per position, so the pool shows no tier chip until the projections lane settles a board-wide tier.
2. The mock data pulled for the screens has no kickers or defenses. The real room has them, and the report's lineup includes them.
3. "Your league's last draft" as a bot style needs the league import that the Draft Pass carries, so it is greyed until then.
4. The 200-run report's rank line reads as a boast when the bots are ADP-only. Keep the basis sentence, and re-measure once the archetype bots are in.
5. The phone report keeps Against ADP and Hindsight as a second line under each pick; the mock page report.html drops them at 390 and should be updated to match the product (rooms design review, 2026-10-14).
6. Lobby abuse: handles are shown to strangers, so names go through the same filter as account names, and a lobby with fewer than three people falls back to the solo room's rules.

## Persona walk

Veteran: 14 went since 4.05 and four were on my queue, so I know what happened without scrolling the wall. The report says Likely at 9.08 would have lasted 96% of the time, which is the lesson I came for. Casual: no clock, one orange button, Enter takes the call, and a whole mock is as long as my own picks. Commissioner: Tuesday night 12 PPR is saved with my slot, so a rerun is one tap, and the lobby fills with bots after 90 seconds instead of making my league wait. First-timer: on the phone the strip of who went and our call come first, and Pick for me to round 8 means I can watch a draft happen before I run one myself.

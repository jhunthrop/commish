# The Draft Advisor

**Status:** founder direction 2026-09-07: "It doesn't feel premium at all and doesn't update as the board updates. If I use it once it always says the same thing. It should assist the user in overall draft strategy. Right now it's SUPER basic. It should give them player draft selection they can click draft from that menu as well."
**Replaces:** the Assistant tab shipped in the Draft HQ room round (`src/draft-room/assistant/*`, `src/draft-service/assistant/call.ts`, `src/draft-room/quilt/components/drawer-assistant-tab.tsx`). That work stays as the engine underneath (candidates by value and need, make-it-back odds from the simulator, build labels, the post-pick beat); this round changes what the manager sees and can do.

## 1. What is wrong today, precisely

- **Stale.** The call is fetched once per pick number. Between your picks the room moves (runs, tier collapses, your targets going), and the tab keeps showing the answer it computed when the pick number last changed.
- **Same words every time.** The lead and the reasons are templates with a few branches, so two picks in a row read alike and the manager learns to ignore them.
- **No strategy.** It answers "who now" and nothing about the draft as a whole: what your roster needs over the next three turns, where the runs are, which tier is about to collapse, what the seats between you and your next pick are likely to take.
- **Not actionable.** Nothing on it can be drafted or queued. The manager reads it, closes the drawer, and finds the player in the pool.

## 2. Goal

A live strategist in the room. It re-reads the board after every pick, tells you the plan for your next three turns and what changed since you last looked, ranks the picks for right now with a reason that is about this player in this room, and lets you draft or queue straight from the card. Every number it shows is measured (the simulator, the board, the roster), every sentence is written for this turn, and the whole thing reads like the best manager in the league leaning over your shoulder.

## 3. Design

### 3.1 The plan: your next three turns

Computed from the simulator the room already has (`continueDraft` over the live state, the same 200-run make-it-back machinery), for the asking seat, after every pick in the room:

- For each of your next three picks: the position the plan targets (from roster need under the league's shape plus the value curve), two or three named targets with their make-it-back odds at that pick, and the fallback if they go.
- The plan is a single object (`DraftPlan`) with a `computedAtPick` stamp. The card shows "as of pick 4.07" and a "changed since 4.03" line when a target's odds moved more than a stated band or a target went off the board.

### 3.2 Now: the picks for this turn

The existing candidates, re-ranked and re-explained:

- Top five by the existing score, each with: value over replacement, make-it-back odds if you pass, the roster slot it fills, and ONE reason sentence written for this player in this room (the narrative slot machinery from the writer round: a `draft:call` slot per candidate per turn, validated for grounding against the turn's own fact ledger, template fallback per slot). The template stays the floor; two identical sentences on one card is a defect the repetition check catches.
- When you are on the clock, each candidate carries **Draft** (the same pick action the pool uses, with the same confirmation rules). When you are not, each carries **Queue** (the draft queue that already exists), and the queue order is visible on the card.

### 3.3 Room signals

A strip above the plan, measured from the live pick log and the board:

- **Runs:** "3 of the last 4 picks were RBs." Fires when a position takes at least three of the last four picks.
- **Tier collapse:** "One WR left in tier A, then a 22.6 point drop." From the board's tiers (the games-worth rule).
- **Ahead of you:** the seats between now and your next pick, each with the position their roster most needs, so "two of the three seats before you need a QB" is on the screen. Need is the same need score autopick uses.
- **Byes and stacks:** the bye-cluster note and the stack candidates already computed, kept.

### 3.4 Freshness

The advisor recomputes on every pick event the room streams (the league event stream already carries picks), not on pick-number change alone, and shows its stamp. The post-pick beat's latch stays as it is (the beat is about YOUR pick; the plan is about the room). Recomputes are cheap on the server (the sim runs in a worker with a budget) and the client shows the previous plan with a "recomputing" state, never a blank.

### 3.5 Voice

Two written elements per turn, both through the narrative slot machinery with grounding and per-slot fallback:

- The **strategy note**, two sentences at most: what the room is doing and what that means for your next pick ("Backs are going early and the seats ahead of you both need one; the receiver tier holds through your turn, so take the back now and the receiver comes back to you.").
- The **candidate reason** per pick, one sentence each.

Generation runs when you are two picks from the clock and again when you land on it, with a two-second budget; if the writer is late the template shows and the written one replaces it when it lands. No gateway call is ever on the critical path of the Draft button.

### 3.6 Premium feel

Design v5 laws apply: a timing tower, not a spreadsheet. The tab is three bands: the signals strip, the plan rail (three columns, one per upcoming turn, targets stacked with their odds as a meter), and the now card (five rows with Draft or Queue on each). The Draft button is the loudest element on the tab when you are on the clock and nothing else competes with it. Mobile keeps the same three bands stacked. A design mockup is produced first and personas review it (veteran, casual, commissioner, first-timer) before implementation, per the standing rule that direction is approved from mockups.

### 3.7 Honesty

Odds are the simulator's own frequencies over its runs and say so. A target with no odds (a position the shape never starts, a player with no board row) shows no odds. Reasons never name a number that is not on the turn's ledger. The plan for a turn beyond the draft's end does not exist.

## 4. Non-goals

- Changing the autopick engine or the simulator's model.
- Auction drafts. The advisor ships for snake first; the auction depth plan owns the auction room.

## 5. Testing

Plan computation on a fixture draft (targets, odds, fallback, stamp, changed-since); signals on fixture pick logs (run, collapse, ahead-of-you); freshness on a streamed pick event; Draft and Queue actions wired to the existing engine actions with the same confirmation; narrative slots validated and falling back; the repetition check across candidates on one card; design guards; the mockup persona pass recorded; one targeted Playwright spec on the seeded fixture draft (open the tab, see the plan, queue a target, draft on the clock).

## 6. Rollout

Behind the writer and fact-sheet rounds (it consumes the narrative slot machinery). Deploy, open the assistant demo page on the seeded fixture, verify the three bands and a Draft from the card.

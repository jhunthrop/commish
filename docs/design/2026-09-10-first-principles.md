# Commish from first principles

**Status:** round one, 2026-09-10. Mockups and principles, not product code. Replaces the razor of v5 ("a timing tower, not a spreadsheet") and the v6 warmth pass, both judged rigid three times. Nothing in the token system is changed by this document. What survives from every earlier version is the refusal list: no invented numbers, no tint without a stated population, no team colour behind text, a dash is never a zero, every number names its basis.

The founder's brief: *"Let's start from the ground up and come up with the best UX for a fantasy site from first principles. I want it to feel fun and engaging."* Standing references: the feel of Flock (never its palette or branding) and the friendliness of FantasyPros' suggestion rows (faces first, the name largest, one big number, one loud action, human words). Competitor names never reach product copy. This is an internal document and names them once here for scoping.

Mocks: `docs/design/mocks/2026-09-10/index.html` lays the three directions side by side. One file per direction per screen under `docs/design/mocks/2026-09-10/<direction>/`.

---

## 1. Start from the manager

Not the screens. A manager is a person who has agreed to care about a small made-up team for five months, in a group of people they mostly like, for stakes that are mostly pride. Everything the product does is in service of eight jobs, and the jobs are unequal in how often they happen and how they feel.

| Job | How often | The feeling it should leave |
|---|---|---|
| Draft | Once a season, two hours | The best night of the year. Nervous, loud, then proud of the team you built. |
| Set a lineup | Weekly, ideally two minutes | Done, confident, nothing left to second-guess. |
| Work the waiver wire | Weekly, Tuesday night and Wednesday morning | A small hunt. The thrill of a claim that lands, the sting of one that misses. |
| Trade | A few times a season, days of back and forth | A negotiation between friends. Suspicion, then a deal both sides can defend in the room. |
| Follow live scoring on Sunday | Every Sunday, all day, in glances | The game inside the game. Anticipation, the reveal, the swing, the last Monday-night prayer. |
| Research a player | Constantly, in ten-second bursts | An answer, fast, that you trust enough to act on. |
| Run or join a league | Once, at the start | For the joiner, "I found my people". For the commissioner, "I did not have to do the job". |
| Talk to the room | Always, in the gaps between everything else | Belonging. The banter is why anyone is still here in year six. |

Two of these carry almost all the emotion (the draft and Sunday). Three are chores that should feel like nothing (lineup, waivers, research). Two are social (trade, talk). One is the door (run or join). A product that treats all eight with the same register is a spreadsheet with a chat tab. The register has to change with the job, and the design system has to carry more than one register without becoming two products.

### The arc of a season

1. **August: hope.** Everyone is undefeated. The draft is the peak, and the days after it are the second peak, when you read your roster over and over.
2. **September: proof.** Do the picks work. First rivalries form from first matchups.
3. **October: grind.** Injuries, byes, the wire. The casual manager drifts here if nothing pulls them back.
4. **November: stakes.** The standings mean something. Trades get real. The bottom teams need a reason to keep setting lineups.
5. **December: playoffs.** Half the league is out and watching. The half that is in is terrified.
6. **The week after: memory.** The champion gets a moment that lasts. The league gets a record it can point at next August.

The product's job in October and for the eliminated in December is the hardest design problem in the category and the one nobody solves: give a manager with nothing to play for something to come back for. Rivalry records, a consolation bracket that matters, the room, and next year's draft order are the honest levers. Fake ones (badges for logging in, streaks for opening the app) are ruled out below.

### The arc of a Sunday

- **Morning:** the last lineup check, the inactives, the one swap. One decision with evidence and one verb.
- **1:00 kickoff:** twelve games of numbers start moving. The manager wants to know one thing: am I winning, and who is doing it.
- **The swing:** a touchdown for your opponent's receiver. The screen should feel it before you read it.
- **4:25 and the night game:** fewer players left, the math narrows. "You need 11.4 from Cook" is the whole screen.
- **Monday night:** the reveal. A win should feel like a win. A loss should feel like a loss and still be a place you would open again on Tuesday.

### What makes fantasy fun

- **Rivalry.** A named opponent every week, and a history with them. The product should know you are 4 and 1 against Rey since 2023 and say so at the right moment.
- **Anticipation.** The clock before your pick. The hour before kickoff. A waiver claim pending overnight. Anticipation is a state the interface should render, not hide behind a spinner.
- **The reveal of a score.** Numbers that move while you watch. A score that ticks up is worth ten that are simply printed.
- **The room's banter.** Reactions to a pick, a trash-talk thread on a matchup, the commissioner's Tuesday recap. The talk is not a feature beside the game. It is where the game is felt.
- **A call that pays off.** You benched the chalk and started the sleeper, and he hit. The product should remember you made the call and let you point at it.

### What makes a product engaging rather than merely used

- **A place to return to.** Something changed since you left, and the product tells you what, first. Not a dashboard, a "since you were here".
- **Faces and names.** Managers and players are people. A row with a face is read faster and remembered longer than a row with a code.
- **Motion that answers you.** Press and it moves. A pick lands and the board reacts. Nothing moves that you or the world did not cause.
- **Moments worth screenshotting.** The pick you are proud of, the win, the trade that closed, the trophy. Each gets a frame that looks good in a group text.
- **Progress and streaks that are real.** Wins in a row. Weeks as the top scorer. Head-to-head records. All derived from things that happened in the league, never from opening the app.

---

## 2. The principles

Each one is testable on a screen. Each one says what it rules out.

### P1. The person comes before the number

The first thing readable on any row or card, from arm's length, is a face and a name. The number comes third. Player rows lead with the headshot on the club's colour, then the name at the row's largest size, then the position and team small. Manager rows lead with their avatar and their name, never their team name alone.

*Test:* cover the numbers on any list. Can you still tell who is on it, in order? If not, the row is a table pretending to be a card.

*Rules out:* rows that begin with a rank numeral in display type. Position codes larger than names. Owner names hidden behind team names. Initials-only avatars where a face exists.

### P2. One big number, and it says what it is

Every object shows one number larger than body text, and that number carries a caption naming its basis in the same glance ("20.2 a game, PPR, 2024 weeks 1 to 3"). Everything else on the object is body size or smaller. When there is no honest number, the slot holds a dash and the caption says why.

*Test:* count figures larger than body text on one card. The answer is one. Read its caption aloud. Does it name the rules and the span?

*Rules out:* stat walls with six equal numbers. A bare "225 pts". A percentile with no population. A zero standing in for missing data.

### P3. One action per moment

Each viewport carries exactly one solid button, and it is the act the moment exists for. In the draft that is Draft. On Sunday morning it is Swap or Confirm. On a player page it is the one thing you can do with him from where you are (queue him, start him, claim him, offer for him). Every other control is quiet: text, outline, or a chevron.

*Test:* screenshot the viewport. Count solid buttons. One. Cover it and ask what the screen is for. If the answer changes, the button is wrong.

*Rules out:* two competing calls to action. Solid filters. Loud "way out" buttons. A verb for a decision the manager cannot make yet (off your turn, the draft dock carries no button at all).

### P4. Every live event moves, and nothing else does

A score change, a pick landing, a seat being claimed, a claim clearing, a message arriving: each has a motion, and the motion is the same everywhere it happens. Nothing animates on mount, on scroll, or for decoration. Durations 150 to 400ms, with one longer celebration allowed per moment (the pick landing, the win). Reduced motion loses no information: everything a motion says is also said in words or by a state change.

*Test:* load the screen and do nothing. Anything moving? Fail. Then cause one event. Did exactly the affected thing move, and did the words change too? Pass.

*Rules out:* hero animations, parallax, shimmer on skeletons that outlasts the load, looping marquees that are not a live wire, hover motion that does not signal a target.

### P5. The room is a place, not a page

A league has presence: who is here now, what happened since you were last here, and a way to say something within one tap from every league screen. The room is not a chat tab. Picks, trades, claims, wins and messages are one stream, in one voice, and reactions attach to all of them.

*Test:* from any league screen, can you see who else is around and say something in one tap? Does the league's front page open on what changed since your last visit rather than a static dashboard?

*Rules out:* a chat that lives on its own route. Activity logs in system voice ("Transaction processed"). A league home that looks the same on Tuesday as on Sunday.

### P6. Your rival is always in the frame

On any screen with a week attached, the manager's opponent this week is visible with a face, a name and a score. Matchup first, standings second. The history between the two of you is one tap away and stated in plain numbers.

*Test:* open any in-season screen. Can you find your opponent's name and score without navigating?

*Rules out:* standings-first league pages. Matchups rendered as two team names without the people behind them. "Opponent" as a label.

### P7. Say it the way a friend in the group chat would

Copy is first-person or second-person, short, concrete, and in fantasy words. "He is going later than he should" not "market inefficiency". "You need 11.4 from Cook" not "Projected margin". No tips, no explainer text, no tooltips. If a word needs explaining, change the word. No em-dashes or semicolons.

*Test:* read every sentence on the screen aloud to someone who plays fantasy. Would they say it that way? Is there any sentence whose only job is to explain another element?

*Rules out:* InfoTips. Onboarding tours over the real interface. System voice. Trading vocabulary. Exclamation marks that are not a celebration.

### P8. Every moment worth screenshotting has a frame

The pick landing, the weekly win, the trade that closed, the claim that hit, the championship: each renders as a self-contained card with the league's name, the people, the number, and the date, at a size that looks right in a group text. The frame is the celebration. There is no separate confetti layer that means nothing.

*Test:* at the moment, take a screenshot of the phone. Is it something you would send? Does it say which league and who?

*Rules out:* toasts that vanish in three seconds with no residue. Celebrations without the fact that earned them. Sharing that requires a separate "share" flow to construct the image.

### P9. Progress is real or it is not shown

Streaks, records and badges derive from league events: wins in a row, weeks as top scorer, head-to-head records, draft grades measured against what the board later did. Each one links to the events that earned it. Nothing is awarded for opening the app, logging in on consecutive days, or completing a profile.

*Test:* tap any badge or streak. Does it open the list of the things that earned it? Is each thing a league event?

*Rules out:* engagement badges. Daily login streaks. Level systems. Fake scarcity ("3 people are looking at this league").

### P10. Dense where it decides, roomy where it feels

Density is spent where a manager is comparing (the draft pool, the wire, the game log) and withheld where they are feeling (the lobby, the celebration, the matchup reveal). Dense means rows of 44 to 52 pixels with a face, a name, one number and one verb, never more than five columns. Roomy means one object per viewport band and type at display scale.

*Test:* name the job of the screen. Comparing? Rows must fit at least eight objects per phone screen. Feeling? No more than three objects per band, one big number among them.

*Rules out:* seven-column tables. Padded cards in a comparison list. A celebration inside a table row.

### P11. Honest to the decimal

Every number names its basis (which rules, which span, which population). A dash is never a zero. A held-out measurement never sits beside a live one as the same kind of claim. Tint is spent only on a comparison against a stated set, never on a raw value, and never as the only channel (a sign, a caret or a word rides with it).

*Test:* pick any figure on the screen. Can you say, from the screen alone, what rules and what span produced it, and what it is being compared against if it has a colour?

*Rules out:* bare numbers. Heat maps without a population. Green-versus-red as the only signal. Any number the product would not stand behind in the room.

### P12. Return hooks are real events

The thing that brings a manager back is what changed: a claim cleared, a trade offer arrived, your opponent's player scored, your pick is in three. Notifications and the league front page lead with those and nothing else. Nothing is marked new that did not happen.

*Test:* list every notification the product can send. Is each one a league event a manager would want to know about? Is the league's front page ordered by recency of real events?

*Rules out:* "We miss you" pushes. Marketing in the notification channel. A red dot on a tab with nothing new behind it.

### What the principles rule out together

Generic dashboards. Tables with more than five columns. Decorative motion. Explainer text of any kind. Gradient heroes with centred copy. Purely numeric rows. Two loud buttons. Engagement mechanics not backed by league events. System voice. Invented data, even in a mockup, unless labelled in source as a stand-in.

---

## 3. Three directions

The directions differ in governing idea, not in tint. Each is a complete identity: type, palette in both themes, radii and materials, density, motion vocabulary, imagery stance. All three honour every principle above. They disagree about what the product feels like to be inside.

All faces are on Google Fonts. Team colours come from `TOKENS.team` unchanged. Position stickers keep their six hues in every direction (a legend is a legend).

### 3.1 Under the Lights

**Governing idea:** your league is on television tonight, and you are the one they cut to.

The broadcast package, done for the manager rather than for the network. Where v5 borrowed the timing tower's numbers, this borrows the pregame show's warmth: big slab names, headshots cut out on club colour, a score bug that ticks, a lower third that talks to you by name. It is loud because a broadcast is loud, and it is readable because a broadcast has to be read from a sofa.

- **Type:** `Big Shoulders Display` 700 to 900 for names, numbers and headers (compressed, athletic, not the condensed default). `Archivo` 400 to 600 for sentences and labels. Tabular figures on everything that ticks.
- **Palette (six):**
  | Name | Role | Light | Dark |
  |---|---|---|---|
  | Night | page ground (dark), ink (light) | `#0F1B33` | `#0F1B33` |
  | Broadcast white | ink (dark), page ground (light) | `#F4F1E8` | `#F4F1E8` |
  | Studio | panels, raised | `#E6E9F0` | `#1A2A4A` |
  | Scarlet | live, on the clock, the swing | `#D92D20` | `#FF4B3A` |
  | Gold | you, your row, your verb | `#C48A00` | `#F5B31B` |
  | Bug blue | links, the neutral chip | `#1E63D6` | `#4D9BFF` |
- **Radii and materials:** 4px on panels, 2px on chips. Flat fills, hard 2px rules, no shadows. Diagonal wipes (a 6-degree skew on the lower third's leading edge) are the one flourish. Team colour arrives as a full-bleed panel behind the headshot, edge to edge.
- **Density:** broadcast rows are 52px, names 20px. Five columns maximum, and the fifth is the verb. The board (draft, standings) is a grid of tiles at 44px.
- **Motion:** wipes in at 220ms `cubic-bezier(.2,.8,.2,1)`, out at 160ms. Score changes flip the digit (a 260ms vertical slide). The clock's last ten seconds pulse the scarlet at 1s. Never moves: navigation, the board grid, anything a manager did not cause.
- **Iconography and imagery:** headshots always, cut out on club colour. No illustration. Icons are 2px stroke, geometric. Manager avatars are square with a gold rule when it is you.
- **Where it shines:** Sunday and the draft. **Where it strains:** the wire on a Tuesday night, where a broadcast register can feel like shouting in a library.

### 3.2 Sideline

**Governing idea:** the league is a group of people, and every screen is a conversation among them.

The premium social app. Faces first everywhere, messages and events in one stream, reactions on everything, the product speaking in the room's own voice. Soft, layered, fast, with one saturated blue for what you can do and a warm amber for anything that is yours. It is the direction closest to the FantasyPros row the founder pointed at and to what makes a group chat sticky, built to a premium standard rather than a startup one.

- **Type:** `Bricolage Grotesque` 600 to 800 for names, numbers and headers (expressive at display sizes, calm at 18px, with optical sizing). `Figtree` 400 to 600 for sentences.
- **Palette (six):**
  | Name | Role | Light | Dark |
  |---|---|---|---|
  | Chalk | page ground | `#F6F5F1` | `#121316` |
  | Graphite | ink | `#17181C` | `#F2F2EE` |
  | Court blue | the one verb, links, your messages | `#2457F5` | `#5B85FF` |
  | Streak amber | yours, streaks, held seats | `#E39A0E` | `#F5B341` |
  | Live green | live, presence, a claim that hit | `#128A52` | `#2ED47F` |
  | Rival rose | your opponent, the swing against you | `#D6336C` | `#FF6B9A` |
- **Radii and materials:** 20px on cards and sheets, pills on buttons and chips, 12px on avatars' rings. Layered surfaces with a 1px hairline and a soft 0 4 16 shadow at 6 percent. Sheets slide up over a blurred ground. Team colour lives in the avatar ring and the headshot tile only.
- **Density:** 48px rows, faces at 36px, names 17px. Four columns maximum. The stream is one column always. Research screens (game log, the pool) go dense to 44px with a face still present.
- **Motion:** springs, 240ms `cubic-bezier(.2,.9,.3,1.15)` for anything that appears, 180ms ease-out for anything that leaves. Reactions pop from the finger. Presence dots breathe at 2s. A score change slides the new number up and highlights the row for 600ms. Never moves: the page ground, the nav, other people's cards when you act on yours.
- **Iconography and imagery:** headshots in circles with a 2px club-colour ring. Manager avatars everywhere, always beside their name. Icons are rounded 1.75px stroke. No illustration on core screens. Stickers and GIFs belong to the room, where people put them.
- **Where it shines:** the room, trades, the return visit, the phone. **Where it strains:** the draft board at desktop width, which wants to be a wall and this system wants to be a stream (the mock answers with a wall-plus-stream split).

### 3.3 Tailgate

**Governing idea:** a parking lot before the game. Everyone is in their colours, the grill is on, and the trash talk is affectionate.

The clubhouse warmth the v6 pass reached for, taken all the way instead of layered onto a tower. Sticker-cut faces, mustard and grill-red, chunky type, hard offset shadows like a printed flyer. It is the most fun of the three by a distance and the one that has to work hardest to stay premium.

- **Type:** `Unbounded` 600 to 800 for names, numbers and headers (wide, friendly, unmistakable at display size). `Rubik` 400 to 600 for sentences (warm corners, real tabular figures).
- **Palette (six):**
  | Name | Role | Light | Dark |
  |---|---|---|---|
  | Canvas | page ground | `#F5F0E6` | `#1F1B18` |
  | Asphalt | ink, sticker outlines | `#24201D` | `#F4EFE6` |
  | Mustard | you, your verb, the trophy | `#D9A21B` | `#F2C230` |
  | Grill | live, the swing, a clock running out | `#D9481F` | `#FF6A3D` |
  | Cooler | links, the neutral chip, away team | `#2A5FCC` | `#5F8DFF` |
  | Turf | a claim that hit, a win | `#22894F` | `#3DBE76` |
- **Radii and materials:** 16px on cards, 999px on chips, a 2px asphalt outline on anything you can press and a 3px 3px 0 asphalt offset shadow that collapses to 0 on press. Sticker frames: a 3px canvas border around every headshot, rotated 1 to 2 degrees on celebration moments only. Team colour fills the sticker behind the face.
- **Density:** 52px rows, faces at 40px, names 18px. Four columns maximum. Research screens go to 46px with the sticker shrunk to 28px.
- **Motion:** 280ms `cubic-bezier(.34,1.56,.64,1)` slap-in (scale 1.12 to 1 with a 2-degree settle) for anything that lands (a pick, a claim, a message). Press is a 1px translate plus the shadow collapse, 80ms. A score change bumps the number 1.08 and back in 300ms. Never moves: the ground, the standings, anything on mount.
- **Iconography and imagery:** headshots as stickers on club colour. Manager avatars as round stickers. Icons are 2.25px stroke, slightly rounded, hand-drawn in feel but geometric in construction. Spot illustration permitted for empty states only (a cooler, a folding chair), never a mascot on a core screen.
- **Where it shines:** the front door, the pick landing, the win, the room. **Where it strains:** the game log and the trade calculator, where the sticker outline costs pixels and the register can read young to the veteran.

---

## 4. The persona panel

Three lines each, per direction. The panel is the standing four: the veteran (year twelve, three leagues, reads ADP for fun), the casual (one league with college friends, sets a lineup Sunday morning), the commissioner (runs the league, collects nothing, hears every complaint), the first-timer (joined a house league because a coworker would not stop talking about it).

### Under the Lights

- **Veteran:** "This is the one that respects the game. The board reads like a real broadcast and the numbers are big enough to trust." "The clock in scarlet with ten seconds left is exactly the panic I want." "I would want the wire quieter than this."
- **Casual:** "It looks like Sunday. I get it instantly." "Feels a bit like being yelled at when I am only checking a score at brunch." "The lower third telling me I need 11.4 from Cook is the whole app for me."
- **Commissioner:** "My league will think it is the most legit thing they have joined." "Where do I talk to people? The stream feels bolted on beside the broadcast." "The pick-landing card is the screenshot they will post, and it has the league name on it."
- **First-timer:** "I know what a broadcast looks like, so I know where to look." "It is intense. I am not sure it wants me." "The one gold button per screen saved me. I never wondered what to do."

### Sideline

- **Veteran:** "Faces first is right and I did not expect to say that." "The pool at desktop wants to be a wall and it keeps wanting to be a feed. The split view fixes it but I notice the seam." "The odds stated as 61 of 100 runs is the honesty I pay for."
- **Casual:** "This is the one I would actually open on a Tuesday." "The room and the scores in one stream means I stop missing things." "I like that my opponent is a person with a face at the top and not a team name."
- **Commissioner:** "Reactions on picks and trades will carry my league through October on their own." "The trade thread as a conversation with the offer inside it is how my league already does it in texts." "It is the most premium of the three. The others look like a theme, this looks like a product."
- **First-timer:** "It looks like apps I already use, so nothing is scary." "The coworker who dragged me in is right there at the top of the league and I can just say hi." "The one blue button always told me what was next."

### Tailgate

- **Veteran:** "Fun, no question. Whether I trust a projection in a sticker is a different question." "The pick landing is the best moment in any of the three." "By week nine the sticker outlines are going to feel like noise on a game log."
- **Casual:** "This is the one I would show my friends." "I love that a win looks like a party." "It is a lot, all the time. I want the volume to go down between events."
- **Commissioner:** "My league would adopt this identity as its own. The flyer feel matches the group text." "The premium question is fair. Some of my guys pay for tools and they will read this as casual." "The front door is the best of the three. It looks like there are people inside."
- **First-timer:** "The friendliest by far. Nothing here made me feel dumb." "I did not always know which sticker was a button until I pressed one." "The trophy and the sticker faces made me want to win."

**Panel leaning:** Sideline, three of four. The veteran leans Under the Lights for the draft and Sunday and would take Sideline everywhere else. Tailgate wins the emotional moments outright and loses the everyday.

---

## 5. Recommendation

**Build Sideline, and let it borrow two things.**

Sideline is the direction that answers the brief at the level the brief was written: fun and engaging come from people, and Sideline puts people on every screen without a special mode for it. It is the closest to the two references the founder pointed at (the feel of Flock, the friendliness of the suggestion row) while being the most clearly premium of the three. It is the only one of the three where the room (P5) is not a compromise with the rest of the system, because the whole system is a stream of things people did. It survives October: a return visit lands on what changed since you left, with faces, in one column, and that is the exact problem the category leaves unsolved. It is the one the phone was designed for first, and the phone is where a season is lived.

It borrows the **pick-landing and win frames from Tailgate** (the slap-in and the sticker-cut face on club colour, once per moment, at celebration scale only) because Tailgate's celebration is the best in the set and Sideline's springs are quieter than the moment deserves. It borrows the **score bug and the "you need 11.4 from Cook" lower third from Under the Lights** for Sunday only, because Sunday is a broadcast whatever the rest of the week is. Both borrowings are bounded: the sticker never appears on a research row, the lower third never appears off Sunday.

**Why not Under the Lights:** it is the best draft room and the best Sunday, and it is v5 again with warmer clothes. The founder has called the broadcast register rigid three times. The mock is here because a broadcast package done for the manager rather than the network deserves one honest look, and because its Sunday pieces are worth taking.

**Why not Tailgate:** it is the most fun and the least premium. The founder's bar is "the most premium in fantasy", and Tailgate has to work hardest to stay on the right side of it. As the whole system it will read young to the veteran and the commissioner who pays for tools. As the celebration vocabulary inside Sideline, it is exactly right.

### Risks

**Sideline**
- The desktop draft board. A stream system wants one column and a draft wants a wall. The mock's answer (board on the left, stream and advisor on the right, the pool in a drawer) has to be built and used before it is trusted.
- Resemblance. A premium social fantasy app is a described category. The palette, the honesty of the numbers, and the house-run league are the differentiation. Copy and identity work has to keep it from reading as a look-alike.
- Restraint under pressure. Springs and reactions can become noise. P4 is the guard and needs its test enforced in review the way the raw-colour sweep is enforced in code.

**Under the Lights**
- Rigidity, again. The founder has rejected this register three times in gentler forms.
- Volume on chores. The wire and the lineup screen do not want a broadcast.
- The room. It never stops feeling bolted on beside a broadcast.

**Tailgate**
- Premium. Sticker outlines and offset shadows read as playful and can read as cheap, especially on data-dense screens.
- Fatigue. What is delightful in August can be exhausting in November.
- Trust. A projection inside a sticker is a projection people trust slightly less, and the product's edge is that people trust its numbers.

---

## 6. What happens next

1. Founder direction approval from the mocks (`index.html`).
2. A token proposal for the approved direction: colour roles in both themes with the same contrast gates v5 carried, the two faces, radii, motion durations and easings as named tokens, the celebration frame as a primitive.
3. One real screen built on the tokens (the league front page, because it is where P5, P6 and P12 meet) and walked tap by tap by the persona panel before anything else is touched.
4. The design-system document rewritten to these principles, with each principle's test written beside the source test that enforces it where one can.

---

## Appendix: data provenance in the mocks

Every number in the mocks is either sourced or labelled as a stand-in in an HTML comment beside it. Real sources used:

- BUF weeks 1 to 3 of 2024, per player, from `src/projections/nflverse/fixtures/stats_player_week_2024_buf_w1-3.csv` (nflverse): game lines and fantasy points, PPR and standard. James Cook's three weeks are 13.3, 28.5 and 18.7 PPR (10.3, 27.5, 14.7 standard), a 20.2 PPR average over three weeks. Josh Allen's are 31.18, 9.76 and 30.92.
- Snap shares from `snap_counts_2024_buf_w1-3.csv`. Target shares from the stats file.
- Bio and draft slot from `players_slice.csv` (Cook: 5 foot 11, 190, Georgia, 2022 round 2 pick 63, number 4). Headshot URLs from the same file.
- 2025 NYG names from `roster_weekly_2025_nyg_w1-4-5-18.csv` (Malik Nabers, Cam Skattebo, Jaxson Dart, Tyrone Tracy Jr., Wan'Dale Robinson, Theo Johnson, Darius Slayton).
- League and manager names from `src/draft-room/test-fixtures.tsx` (Sunday Money, Bay Bandits, Dana Whitfield, Iron Owls, Rey Okafor, Turf Burners, Coach Parker). Additional seats in the mock draft are stand-ins.
- House league names from `src/matchmaking/house-catalog.ts`.
- Front-door copy verbatim from the product.

Not sourced, and labelled as stand-ins in every file: ADP, expert rank, season projections, tier drops, make-it-back odds, seat counts and times on the front door, the pick clock's seconds, and the messages in the room. The repo holds no rankings export or ADP fixture. The stand-ins exist to show layout and are never presented as a fact about a real player.

---

## 7. Draft room rulings after the founder's review (2026-09-10)

The founder chose Sideline and, reviewing the draft room, added four rulings. Mock: `docs/design/mocks/2026-09-10/sideline/draft-room-your-sheet.html`, built from the production board export of 2026-09-08.

1. **Your sheet is a view of the board region, not a drawer tab.** A two-position switch, Wall and Your sheet. Your sheet is seven columns (Overall, QB, RB, WR, TE, K, D/ST) of up to fifty, tiers as sticky bands inside each column with the count left, taken players struck in place, your picks in amber, one odds number per row (still there at your next pick, runs over runs, the same bands as the pool), a flag for targets, drag to reorder, Draft on the row when on the clock and Queue off it, a Hide taken toggle and a jump to the next open tier, a column strip with counts. K and D/ST carry no tiers. It starts as our board until the manager moves something and says so. The old six-tab drawer (Pool, Assistant, My sheet, Roster, Byes, Picks) goes: the pool is the drawer, the picks are the stream, byes and stacks are chips on rows and the peek, rosters are sheets from the wall header.
2. **The stream collapses.** Three widths remembered per browser: open at 320, a 64px rail (faces with presence, an amber mention pill, the last pick as a face and position chip, our call as a face and a number), and hidden with a small "new" pill on the top strip. The rail is the desktop default. The phone keeps the stream as the screen.
3. **Our call sits in the dock beside the Draft verb** when you are on the clock, so the advice is with the action whatever the stream's width.
4. **Performance is a requirement, measured.** Seven columns of fifty with a pick landing every 700 ms: no dropped frames, one row re-rendered per pick, virtualized columns, rows keyed by player id. The fluidity round's measurements (re-renders, long tasks, receipt-to-cell, dropped frames) are the harness.

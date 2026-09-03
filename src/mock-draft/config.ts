/**
 * The mock draft vocabulary's root: every tunable a mock room's creation form, its ticker and its
 * bots read from the SAME object, `MOCK_CONFIG` below, and the one set of honest, sweep-clean
 * sentences a mock room ever shows a member, `MOCK_COPY` beside it. Pure, no I/O, no `Date.now()`
 * — the same shape `MONEY_CONFIG` (`src/money/config.ts`) and every other directory on
 * `docs/conventions.md`'s directory map follows, for the identical reason: a fee ceiling, a pick
 * clock option or a practice-room sentence that lived twice could drift twice.
 *
 * UNLIKE `src/money`, this directory is on the BLOCKED side of the client boundary
 * (`eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`, beside `@/integrity`), not the browser-safe
 * exempt side, even though everything in it today is pure. Two reasons, both load-bearing:
 *
 *  1. `MOCK_CONFIG.strategy` (`temperature`, `reachDepth`, `runReaction`) is how a bot decides
 *     what to draft. Shipping those numbers into the client bundle as inspectable data would let
 *     a member solve the bot instead of practicing against it — a "practice opponent" a member
 *     can read the playbook of is not practice, the same reasoning that keeps a moderator's own
 *     nudge logic (`DRAFT_NUDGE_CONFIG`) off any browser-facing surface.
 *  2. The room-facing words in `MOCK_COPY` reach a mock draft room the same way `NoticeView`
 *     (`@/account-room/contract`) and `ActivityRow` (`@/integrity/activity-view`) reach theirs:
 *     pre-rendered from the server, `import type` only, never a live `import { MOCK_COPY }` from
 *     client component code. A later task's mock-room component receives the banner text and the
 *     bot marker as PROPS, not as a value pulled from this module.
 *
 * `src/mock-draft-service/**` (a later task, gate 26) is this directory's Postgres/Redis half —
 * the room store, the bot ticker, the seat draw — and stays exactly as blocked as `@/integrity-service`
 * always has been. This pure half and that service half are ONE boundary, not two, the same
 * "gate the whole directory once" reasoning `@/integrity`/`@/integrity-service` already set.
 */
export const MOCK_CONFIG = {
  /** The three founder-required modes. `solo` seats bots at creation; the other two top up at
   *  start. See `docs/decisions/` for the self-ruling that closed this to exactly three. */
  modes: ["solo", "lobby", "link"] as const,
  teamCountOptions: [8, 10, 12] as const,
  /** Practice clocks. 30s is Underdog's fast-mock pace; 60s default; 90s matches the real floor
   *  (`DRAFT_CLOCK_SCHEDULE`'s own last tier, `src/draft-engine/config.ts`) for a true dress
   *  rehearsal. */
  pickClockSecondsOptions: [30, 60, 90] as const,
  defaultPickClockSeconds: 60,
  /** Bot think-delay, seeded per pick — the PACED cadence, for rooms with two or more humans:
   *  a live lobby sees a realistic rhythm, never an eleven-pick burst landing in the same tick.
   *  A room with exactly ONE human seat skips this entirely and sims (the founder's
   *  sim-to-next-pick directive — `MockDraftMeta.simToNextPick`, `@/mock-draft-service/driver`):
   *  realism is for the people sharing the room, and a lone human has no one to share it with.
   *  Max stays under `maxFractionOfClock` of the fastest offered clock so a bot can never be
   *  autopicked by its own dawdling and never collides with the moderator's own nudge threshold
   *  (`DRAFT_NUDGE_CONFIG.thresholdPct`). */
  botDelay: { minSeconds: 3, maxSeconds: 9, maxFractionOfClock: 0.5 },
  /** Rank-weighted sampling temperature and the hard reach cap (founder ruling: varied bots,
   *  never absurd ones). A bot considers at most `reachDepth` eligible players and samples
   *  softmax-ish by rank, warmed toward a reach when the room is mid-run on a position
   *  (`runReaction`): `window` picks back, `threshold` of them at one position, `needBoost`
   *  multiplies that position's weight for a `followsRuns` archetype's own next pick only —
   *  `baseBoost` is the milder tilt EVERY brain gets, because a real room feels a run too.
   *  Positional need reads the roster, never a memory: each open dedicated starting slot at a
   *  position raises that position's weight by `needPerOpenStartingSlot` (scaled by the
   *  archetype's own `needWeight`), and a position whose starters are all rostered falls to
   *  `startersFilledDamp` — a bot with no QB late wants one, a bot with three RBs cools on RBs. */
  strategy: {
    temperature: 3.0,
    reachDepth: 8,
    needPerOpenStartingSlot: 0.4,
    startersFilledDamp: 0.6,
    runReaction: { window: 4, threshold: 3, needBoost: 2.0, baseBoost: 1.3 },
  },
  /** Lobby and link rooms start this long after creation, bots topping up whatever seat is
   *  still empty when the window fires. */
  fillWindowSeconds: 180,
  /** All human seats full before the fill window fires => start this soon instead (the
   *  sit-and-go grace, mock-sized: real leagues have no such grace at all). */
  earlyStartGraceSeconds: 10,
  retention: {
    /** A finished room and its results page live this long, then the sweep clears them. */
    completedMs: 24 * 60 * 60 * 1000,
    /** A room nobody started (the host bailed before the fill window fired and nothing ticked
     *  it) lives this long. */
    unstartedMs: 2 * 60 * 60 * 1000,
    /** An in-progress room abandoned mid-draft (every human skipped out and only bots remain
     *  ticking) is cleared after this. */
    inProgressMs: 6 * 60 * 60 * 1000,
  },
  /** Ticker-lane bounds, following `DRAFT_SERVICE_CONFIG.maxDraftsPerTick`'s precedent
   *  (`src/draft-service/config.ts`) — no scan in this codebase is unbounded. */
  maxMockStartsPerTick: 20,
  maxBotPicksPerTick: 100,
  sweepIntervalMs: 60_000,
  /**
   * Task 7: `GET /api/mock-drafts`'s own cap on both halves of the lobby read (the open-room
   * listing and the caller's own rooms) — the identical "no scan in this codebase is unbounded"
   * rule the ticker bounds above already keep, on a table the retention sweep already keeps
   * small (`retention`, above) rather than a table that grows with the whole platform's history.
   * Smaller than `MATCHMAKING_CONFIG.maxResults` (48) on purpose: a practice lobby a stranger can
   * actually scan is a shorter list than the real browse page's whole member shelf.
   */
  maxLobbyListing: 20,
  /**
   * The learning column's own cap (the workflow pass, law 3): how many completed mocks
   * `completedMockDebriefs` (`@/mock-draft-service/debrief`) summarizes per read. Each summary
   * loads a whole stored draft state, so this is the costliest read the lobby page makes —
   * retention (`retention.completedMs`, above) already keeps the population under a day deep,
   * and this bounds the walk regardless: one featured mock plus a short run of earlier rows is
   * everything the page renders.
   */
  debriefHistoryLimit: 6,
  /**
   * Task 7's per-user ceilings on the mock-drafts surface — every route behind it requires a
   * signed-in caller (no anonymous rooms), so each is keyed on the caller's own id, the identical
   * shape `ADVISOR_CONFIG.maxRequestsPerWindow`/`rateLimitWindowMs` and
   * `MATCHMAKING_CONFIG.browseRateLimit`/`holdRateLimit` already use for their own routes — see
   * `createRateLimiter`'s own docblock for what a single-process fixed window is and is not.
   */
  rateLimit: {
    /** `POST /api/mock-drafts` — the costliest single call this domain exposes: a whole
     *  room-creation transaction (the bot roster ensured, a league/draft/team write, a
     *  share-code mint loop) followed, for solo mode, by an immediate start. Tighter than a
     *  real league's own creation route, which has none at all, because a mock costs nothing to
     *  request and a script could otherwise mint rooms the retention sweep would only ever
     *  have to clean up. */
    create: { maxRequests: 10, windowMs: 60_000 },
    /** `POST /api/mock-drafts/[code]` — one seat claim, the same write-is-tighter-than-read
     *  shape as `MATCHMAKING_CONFIG.holdRateLimit`. */
    claim: { maxRequests: 20, windowMs: 60_000 },
    /** `GET /api/mock-drafts` and `GET /api/mock-drafts/[code]` share ONE budget — both spend
     *  the same scarce thing, a read-time database query, the identical shared-budget reasoning
     *  `advisorRateLimited`'s own docblock states for its two routes. */
    read: { maxRequests: 60, windowMs: 60_000 },
  },
  /**
   * The named bot roster a room draws its seats from — 24 total, more than the widest room
   * (`Math.max(...teamCountOptions) + 4`, `config.test.ts`'s own gate on this) needs even if a
   * mock somehow reused the same seat twice in one draw. A bot's `id` is what a stream key in
   * `rngFor` (`./rng`) is built from, so the id, once shipped, is load-bearing for replay and
   * must never be renamed out from under an in-flight seed.
   *
   * `name` is the OWNER a member sees seated across the table — a playful, coach-style handle,
   * never a claim of intelligence and never a realistic full name a member could mistake for
   * another person's (founder directive 2026-08-26: a mock draft should feel like drafting
   * against real people, not a wall of "X Bot" labels, without ever pretending a bot is one).
   * Two rules keep the illusion honest rather than deceptive: the visible "Bot" marker
   * (`MOCK_COPY.botBadge`) stays on every bot seat everywhere, unconditionally — the name is
   * flavor, the badge is the truth — and no name may spell "bot" or "AI" as a whole word, or
   * carry any of `config.test.ts`'s banned strategy vocabulary, so a member can never read a
   * bot's archetype off the seat label the way "Zero RB Bot" or "Contrarian Bot" once let them.
   * `MOCK_BOT_TEAM_NAME_POOL` (below) is the separate, unrelated pool a bot's TEAM is named
   * from — never this array — so the same bot's owner handle and team name never collide.
   */
  botRoster: [
    { id: "bot_park", name: "Coach Parker" },
    { id: "bot_earlybird", name: "Dana Q." },
    { id: "bot_latenight", name: "Marty the Commish" },
    { id: "bot_chalk", name: "Coach Bee" },
    { id: "bot_contrarian", name: "Sam T." },
    { id: "bot_sleeper", name: "Lena K." },
    { id: "bot_valuehunter", name: "Pixel Pete" },
    { id: "bot_zerorb", name: "Auntie Vee" },
    { id: "bot_workhorse", name: "Coach Ramirez" },
    { id: "bot_stacker", name: "Frankie Twice" },
    { id: "bot_rookietruther", name: "Coach Delgado" },
    { id: "bot_steadyvet", name: "Uncle Randy" },
    { id: "bot_upside", name: "Miss Fixit" },
    { id: "bot_safefloor", name: "Coach Ortiz" },
    { id: "bot_committee", name: "Skip the Ref" },
    { id: "bot_benchdepth", name: "Coach Reyes" },
    { id: "bot_streamer", name: "Nana Debbie" },
    { id: "bot_hunch", name: "Deacon Fife" },
    { id: "bot_spreadsheet", name: "Coach Tanaka" },
    { id: "bot_gutcheck", name: "Reggie Overtime" },
    { id: "bot_lastyear", name: "Coach Winslow" },
    { id: "bot_riskaverse", name: "Big Country Dale" },
    { id: "bot_boomorbust", name: "Coach Alvarez" },
    { id: "bot_homer", name: "Lucky Jean" },
  ],
} as const;

/**
 * The pool `pickBotTeamNames` (`./team-names`) shuffles and takes from, one seeded draw per
 * room's `botSeed` — a bot's TEAM name, distinct from its owner handle above
 * (`MOCK_CONFIG.botRoster.name`) the same way a real member's team name is distinct from their
 * profile display name. Fun, generic fantasy-football flavor, never a member-facing claim:
 * `config.test.ts` enforces the identical banned-vocabulary and no-"bot"/"AI" rules
 * `MOCK_CONFIG.botRoster` names carry, so a team name can never leak the archetype dealt to the
 * bot sitting in that seat (`assignArchetypes`, `./archetypes`, a wholly separate seeded deal off
 * the SAME `botSeed` — this pool and the archetype deck are two independent draws, never
 * coupled). At least `MOCK_CONFIG.teamCountOptions`' widest room needs (`config.test.ts`'s own
 * gate), so a full 12-bot room never runs the pool dry. Founder directive 2026-08-26.
 */
export const MOCK_BOT_TEAM_NAME_POOL = [
  "Turf Burners",
  "The Waiver Wolves",
  "Fourth Down Fanatics",
  "Bench Mob",
  "The Garbage Timers",
  "Flex Appeal",
  "Trophy or Nothing",
  "Gridiron Grinders",
  "The Taco Tuesday 12",
  "End Zone Enthusiasts",
  "Red Zone Renegades",
  "The Comeback Kids",
  "Blitz Brigade",
  "Pigskin Pirates",
  "The Tailgate Titans",
  "Fantasy Outlaws",
  "The Sunday Scholars",
  "Field Goal Fanatics",
  "The Draft Dodgers",
  "Turnover Kings",
  "The End Around",
  "Hail Mary Heroes",
  "The Scramble Squad",
  "Gridiron Gladiators",
] as const;

/** The three founder-required mock room modes, named once (`MOCK_CONFIG.modes`) and shared as a
 *  type the way every other closed vocabulary in this codebase is. */
export type MockMode = (typeof MOCK_CONFIG.modes)[number];

/**
 * The mock draft's honest words, named once. Every one of these passes `copyViolations`
 * (`@/integrity/copy-rules`) — no em or en dash, nothing accusatory, no passive construction, no
 * contraction, and none of C3's or this phase's own forbidden vocabulary. The house rule this
 * whole object exists to keep: a mock room is practice, says so in plain words, and never claims
 * a bot is intelligent, learning, or anything other than a named, seeded opponent.
 */
export const MOCK_COPY = {
  /** The banner every mock room shows, verbatim, for the whole life of the room. */
  practiceBanner:
    "This is a mock draft. Nothing here counts, and this room clears itself after a day.",
  /** The `leagues.name` every mock room is created under (`createMockRoom`,
   *  `@/mock-draft-service/creation`, Task 5) — rendered wherever a real league's own name would
   *  be, so it says plainly what the room is rather than pretending to be a league. */
  roomName: "Mock draft",
  /** The accessible label a bot's seat carries alongside its visible "Bot" badge below — never
   *  "AI opponent," because this product makes no claim of intelligence about a seeded sampler. */
  botMarkerLabel: "practice opponent",
  /** The short visible badge text placed beside a bot's name in the room and on the board. */
  botBadge: "Bot",
  /**
   * R2 (the draft-room design review's carry, Task 10): the scheduled rail's waiting sentence
   * for a practice room — the trigger-aware answer to "what starts this draft", carried to the
   * room over the wire (`DraftSnapshotBody.waiting.detail`) like every other string here. A
   * real league's rail quotes `describeStartTiming` (`@/matchmaking/roll`) instead; a mock's
   * start has its own trigger (the fill window), so it gets its own honest sentence.
   */
  waitingDetail:
    "Practice opponents fill any open seats.",
  /** The results page heading (the workflow pass: the blueprint's own word for the surface).
   *  Deliberately not a grade or a score against the room: this product invents no draft-grade
   *  authority (founder self-ruling) — a debrief states facts, it never scores them. */
  resultsHeading: "The debrief",
  /**
   * R2 (the lobby design review's ruling): the page's own lead sentence, read directly by the
   * server page (`src/app/app/(shell)/mock-drafts/page.tsx`) beside its `<h1>` — never threaded
   * as a `MockLobby` prop, since the page's own heading lives in the page itself, not the client
   * component below it. States what a mock draft IS, that it costs nothing, that nothing counts
   * and that it is quick, all in one sentence, before the settings form asks anything: the front
   * door sells this promise (`FrontDoorHero`'s own copy); this page is the surface the funnel
   * actually lands on, and it used to say none of this until the room's own `practiceBanner`
   * (below), which nobody sees until after they have already committed.
   */
  lobbyPromise:
    "A mock draft is the real room against practice opponents. Free, nothing counts, done in minutes.",
  /**
   * THE WORKFLOW PASS (2026-09-03, the canvas laws): the page's own sentences. Law 1 leads with
   * one verb and a chip sentence; law 2 makes people a door (an EMPTY lobby renders NOTHING, so
   * the old `lobbyEmptyMessage`/`lobbyHistoryEmptyMessage` pair left with the surfaces that said
   * them); law 3 gives the learning the page's second half. Every sentence crosses to the client
   * page component as props (ruling 8, the client boundary) and passes `copyViolations` like the
   * rest of this object.
   */
  soloDetail: "In the room in five seconds. The bots pick the way real rooms do.",
  tableHint: "Tap any chip to change it. Your last table is remembered.",
  openLobbyDetail: "Anyone can take a seat; bots fill whoever does not show.",
  crewDetail: "A private link seats your league mates; practice the real draft together.",
  sheetTieIn:
    "Drafting for real soon? Your mock picks can seed your cheat sheet, so practice walks into the real room with you.",
  pageFootnote: "Practice rooms clear themselves after a day. Nothing here touches a real league.",
  /** Law 3: the learning column's own sentences. `{count}`/`{fraction}` are the only tokens. */
  learningHeading: "What your last mock says",
  earlierHeading: "Earlier mocks",
  learningFootnote: "The debrief shows all {count}, judged against the board at the moment you picked.",
  bestFractionRow: "{fraction} best available",
  /**
   * Task 8's own results-page line, beside `resultsHeading`. The number is a literal, not a
   * computed `MOCK_CONFIG.retention.completedMs` string, for the same "no reader should do
   * arithmetic" reason `practiceBanner`'s own "after a day" phrasing already accepts — pinned
   * against the real config value in `config.test.ts` so the two can never quietly drift apart.
   */
  resultsRetentionSentence:
    "Your results stay here for 24 hours, then this room clears itself.",
  /**
   * The verdict lane's label and its empty sentence (E6's "no surface's own words skip the
   * gate" rule carried into the workflow pass; the roster-list labels this block used to hold
   * left with the roster list itself — the debrief's team card replaced it).
   */
  resultsPicksHeading: "Your picks",
  resultsNoPicksMessage: "You did not draft anyone in this room.",
  /**
   * The pick-fact sentence (finding D3 + ruling R2): the honest replacement for the old,
   * un-normalized "The board ranked X Nth" line, which implied a verdict a raw rank never
   * earned (a round-15 kicker with a huge raw rank can still be the board's own best kicker
   * still available). `state/format.ts`'s `formatPickFactClause` picks whichever of these three
   * fits `reviewPicks`' own facts (`state/pick-review.ts`) — a pure derivation of the draft's own
   * log, never a judgment. `{position}`/`{count}` are the only tokens any of the three carries.
   *
   * The lead-in ("You took X at pick N.") and the position-rank clause ("WR6 on the board.") were
   * both retired in Sunday v5: the results row prints the pick number and the name in their own
   * columns, and the position rank now rides `PositionBadge`'s own `rank` prop, the way the pool
   * has always drawn it.
   */
  resultsPickBestAvailable: "Best available",
  resultsPickPositionBestAvailable: "Best {position} available",
  resultsPickRankedHigherAvailable: "{count} ranked higher",
  /**
   * THE DEBRIEF'S OWN SECTIONS (the workflow pass, law 4). The one solid verb is the rematch;
   * the lobby link stays as the quiet way out ("never a dead end", Task 8's rule, kept). Every
   * `{token}` is filled by `fillCopyTemplate` (`@/draft-room/state/format`) from facts the
   * stored draft actually supports — a clause whose fact is not derivable drops silently, per
   * the canvas laws.
   */
  resultsRunBackVerb: "Run it back, same table",
  resultsOpenLobbyLabel: "Open the mock draft lobby",
  resultsStatBestAvailableCaption: "picks were the board's best available at your turn",
  resultsStatReachCaption: "reaches, {threshold} or more ranked higher when you picked",
  resultsStatFirstTeCaption: "your first tight end",
  resultsStatNoTeCaption: "tight ends taken all draft",
  resultsRoomAverageClause: "the room's average was round {round}",
  resultsTeamHeading: "The team you built",
  resultsShapeSentence: "{count} {position} inside your first {rounds} rounds.",
  resultsByeStackSentence: "Byes stack in week {week}: {count} of your players sit out together.",
  resultsTakeItHeading: "Take it with you",
  resultsSeedDetail:
    "Your mock picks can seed your cheat sheet, so the real room already knows who you want.",
  resultsSeedVerb: "Seed my sheet",
  resultsSeededConfirmation: "Your sheet is seeded. The next room you open without a sheet starts from these picks.",
  resultsTrySeatVerb: "Try seat {seat} instead",
  resultsHabitsHeading: "Across your last {count} mocks",
  resultsHabitsTeSentence: "Your first tight end went in rounds {rounds}.",
  resultsHabitsEarlySentence: "Your first two rounds were all best available in {count} of {total} mocks.",
} as const;

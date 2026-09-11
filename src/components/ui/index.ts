// Barrel surface: only names actually imported through `@/components/ui` elsewhere in the
// repo. A type, alternate helper, or a component nothing yet renders (e.g. `Icon`) is reached
// by importing its own file directly — see docs/design-system.md's primitives list for the
// full catalog, which is broader than this barrel on purpose.
export { Button, buttonClassName } from "./button";
export { ButtonLink } from "./button-link";
export { Input } from "./input";
export { Textarea } from "./textarea";
export { Card } from "./card";
export { Badge } from "./badge";
export { PositionBadge, positionStickerClass } from "./position-badge";
export { Sticker } from "./sticker";
export { SlotChip } from "./slot-chip";
export { PageTitle } from "./page-title";
export { Skeleton } from "./skeleton";
export { EmptyState } from "./empty-state";
export { ErrorState } from "./error-state";
export { Select } from "./select";
export type { SelectOption, SelectProps } from "./select";
export { Avatar } from "./avatar";
export { Modal } from "./modal";
export { ToastProvider, useToast } from "./toast";
export { Table, type TableColumn, type TableDensity } from "./table";
export { Celebration } from "./celebration";
export { CountdownLabel } from "./countdown";
export { MotionList, type MotionRowProps } from "./motion-list";
/** SIDELINE WAVE TWO (2026-09-11): `Rise`, `InfoTip` and `LiveMarker` left this barrel with their
 *  files. `Rise`'s stagger is `useEntranceClass` (`@/design/use-motion`), which is the one place a
 *  spring is spelled; `InfoTip` is ruled out by P7 ("if a word needs explaining, change the word")
 *  and had no call site left to delete it with; `LiveMarker` retires into `PresenceDot` (the
 *  breathing dot) and `LiveChip` (the dot inside its chip), both already below. */
export { EYEBROW } from "./config";
export { LedgerRow } from "./ledger-row";
export { Panel } from "./panel";
export { Crest, crestTone } from "./crest";
export { SeatMeter, SeatStack } from "./seat-meter";
export { Meter } from "./meter";
export { StatPill } from "./stat-pill";
/** The heat map's one renderer (the fun pass, Task 1). `StatComparison` rides the barrel with it
 *  because a caller that cannot name a population cannot use the component at all. */
export { Stat, magnitudeStep, type StatComparison, type StatSize } from "./stat";
/** The arithmetic that BUILDS a `StatComparison`, and the refusal below `UI_CONFIG.stat
 *  .minPopulation` that keeps one honest. Beside `Stat` on the barrel because the two are one
 *  bargain: name a real population or render ordinary ink. */
export { percentileWithin, comparisonWithin, type HeatDirection } from "./magnitude";

/** GAMEDAY (v4) — the primitives the two approved compositions are built from. Each rides the
 *  barrel with the type a caller cannot use it without: `GameState` because the chip is a closed
 *  union, `TierGrade`'s home is `@/design/tokens` so it is NOT re-exported here. */
export { PlayerFace } from "./player-face";
export { PlayerRow } from "./player-row";
/** A club in the player row's own treatment (site search round): the search overlay's team
 *  result and, later, any list that seats a team beside players. */
export { TeamRow } from "./team-row";

/** THE PLAYER SCREEN (2026-08-28). The player as an object at the size of his own screen, and
 *  the sources side by side beneath him. `SourceValue` rides the barrel with the strip because
 *  it is the whole contract: a number, or the honest absence of one. */
export { PlayerObject, splitName } from "./player-object";
export { SourceStrip, type SourceValue } from "./source-strip";
export { SeasonBars, type SeasonWeek } from "./season-bars";
export { BottomSheet } from "./bottom-sheet";
export { TierDivider } from "./tier-divider";
// Sunday v5's three new primitives: law 2's movement arrow, law 1's delta, law 6's lower third.
export { Movement } from "./movement";
export type { MovementProps } from "./movement";
export { EdgeCell } from "./edge-cell";
export type { EdgeCellProps } from "./edge-cell";
export { LowerThird } from "./lower-third";
export { SegmentGroup } from "./segment-group";
export type { SegmentGroupProps, SegmentOption } from "./segment-group";
export type { LowerThirdProps, LowerThirdCell } from "./lower-third";
// Sunday's borrowed bug (section 5): Under the Lights' shape, Sideline's materials.
export { ScoreBug } from "./score-bug";
export type { ScoreBugProps, ScoreBugSide } from "./score-bug";
export { Scoreboard } from "./scoreboard";
export { PointsShareBar } from "./points-share-bar";
export { GameStateChip, pointsForGameState, NOT_STARTED_DASH, type GameState } from "./game-state-chip";
export { EventFeedRow, signedPoints } from "./event-feed-row";
export { Pill } from "./pill";
/** SIDELINE (2026-09-10): the primitives the league front page is built from, and the vocabulary
 *  every later round migrates onto. `Manager` is the only way a manager's face renders (beside a
 *  name always), `BigNumber` the only big figure (with its basis), `MessageBubble`/`ReactionPill`
 *  the stream's voice, `PresenceDot`/`LiveChip` the live channel. */
export { Manager } from "./manager";
export type { ManagerProps } from "./manager";
export { ManagerStack } from "./manager-stack";
export type { ManagerStackProps, StackedManager } from "./manager-stack";
export { BigNumber } from "./big-number";
export type { BigNumberProps, BigNumberSize } from "./big-number";
export { MessageBubble } from "./message-bubble";
export type { MessageBubbleProps } from "./message-bubble";
export { ReactionPill } from "./reaction-pill";
export type { ReactionPillProps } from "./reaction-pill";
export { PresenceDot } from "./presence-dot";
export { LiveChip } from "./live-chip";
/** The law-backed explanation chip (Task 8): one `BoardReason` rendered as structured copy, plus
 *  the pure ranking helper (`strongestLawReasons`) a compact row uses to pick its top two. */
export { ReasonChip, strongestLawReasons, type LawReason } from "./reason-chip";
export { RosterStatusPill } from "./roster-status-pill";

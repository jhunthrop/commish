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
export { Avatar } from "./avatar";
export { Modal } from "./modal";
export { ToastProvider, useToast } from "./toast";
export { Table, type TableColumn, type TableDensity } from "./table";
export { Celebration } from "./celebration";
export { CountdownLabel } from "./countdown";
export { MotionList, type MotionRowProps } from "./motion-list";
export { Rise } from "./rise";
export { InfoTip } from "./info-tip";
export { EYEBROW } from "./config";
export { LedgerRow } from "./ledger-row";
export { Panel } from "./panel";
export { Crest, crestTone } from "./crest";
export { SeatMeter } from "./seat-meter";
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
export { Scoreboard } from "./scoreboard";
export { PointsShareBar } from "./points-share-bar";
export { GameStateChip, pointsForGameState, NOT_STARTED_DASH, type GameState } from "./game-state-chip";
export { EventFeedRow, signedPoints } from "./event-feed-row";
export { Pill } from "./pill";
/** The law-backed explanation chip (Task 8): one `BoardReason` rendered as structured copy, plus
 *  the pure ranking helper (`strongestLawReasons`) a compact row uses to pick its top two. */
export { ReasonChip, strongestLawReasons, type LawReason } from "./reason-chip";
export { RosterStatusPill } from "./roster-status-pill";

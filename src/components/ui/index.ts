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

/** GAMEDAY (v4) — the primitives the two approved compositions are built from. Each rides the
 *  barrel with the type a caller cannot use it without: `GameState` because the chip is a closed
 *  union, `TierGrade`'s home is `@/design/tokens` so it is NOT re-exported here. */
export { PlayerFace } from "./player-face";
export { PlayerRow } from "./player-row";

/** THE PLAYER SCREEN (2026-08-28). The player as an object at the size of his own screen, and
 *  the sources side by side beneath him. `SourceValue` rides the barrel with the strip because
 *  it is the whole contract: a number, or the honest absence of one. */
export { PlayerObject, splitName } from "./player-object";
export { SourceStrip, type SourceValue } from "./source-strip";
export { SeasonBars, type SeasonWeek } from "./season-bars";
export { TierDivider } from "./tier-divider";
export { Scoreboard } from "./scoreboard";
export { PointsShareBar } from "./points-share-bar";
export { GameStateChip, pointsForGameState, NOT_STARTED_DASH, type GameState } from "./game-state-chip";
export { EventFeedRow, signedPoints } from "./event-feed-row";
export { Pill } from "./pill";

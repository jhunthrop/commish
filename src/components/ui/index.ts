// Barrel surface: only names actually imported through `@/components/ui` elsewhere in the
// repo. A type, alternate helper, or a component nothing yet renders (e.g. `Icon`) is reached
// by importing its own file directly — see docs/design-system.md's primitives list for the
// full catalog, which is broader than this barrel on purpose.
export { Button } from "./button";
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
export { InfoTip } from "./info-tip";
export { EYEBROW } from "./config";
export { Panel } from "./panel";
export { Crest, crestTone } from "./crest";
export { SeatMeter } from "./seat-meter";
export { Meter } from "./meter";
export { StatPill } from "./stat-pill";

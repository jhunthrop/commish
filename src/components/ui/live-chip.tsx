import type { ReactNode } from "react";
import { Badge } from "./badge";

export interface LiveChipProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * THE LIVE CHIP: live green ink on its wash with the breathing dot. One name for the one state
 * ("Live", "Filling", "3 games on") so a call site never assembles a dot and a chip by hand.
 */
export function LiveChip({ children, className }: LiveChipProps) {
  return (
    <Badge tone="live" glow className={className}>
      {children}
    </Badge>
  );
}

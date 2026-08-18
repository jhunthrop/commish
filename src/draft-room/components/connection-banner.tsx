"use client";

import { Badge } from "@/components/ui";
import type { ConnectionStatus } from "../hooks/use-draft-room";

const COPY: Readonly<Record<ConnectionStatus, string | null>> = {
  connecting: "Connecting…",
  live: null,
  reconnecting: "Reconnecting…",
};

/**
 * The connection is only worth mentioning when it is not working. The browser reconnects on
 * its own and the room refetches once it is back, so this is information, not a control.
 */
export function ConnectionBanner({ connection }: { readonly connection: ConnectionStatus }) {
  const copy = COPY[connection];
  if (copy === null) return null;
  return (
    <p aria-live="polite" className="text-sm text-text-muted">
      <Badge tone="warning">{copy}</Badge>
    </p>
  );
}

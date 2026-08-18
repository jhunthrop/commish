"use client";

import { Badge } from "@/components/ui";
import type { ConnectionStatus } from "../hooks/use-draft-room";

const COPY: Readonly<Record<ConnectionStatus, string>> = {
  connecting: "Connecting…",
  live: "Connected.",
  reconnecting: "Reconnecting…",
};

/**
 * The connection is only worth SHOWING when it isn't working — the browser reconnects on its
 * own and the room refetches once it is back, so a visible badge is information, not a
 * control, and stays quiet while live.
 *
 * The `aria-live="polite"` region itself, though, is rendered unconditionally in every state
 * — including "live" — with its text simply swapped between them. A live region that is
 * created together with the content it announces is not reliably announced by most screen
 * readers (there's nothing to diff against yet); mounting it once and only ever changing its
 * text is what makes "Reconnecting…" actually get spoken. The "live" state's text is present
 * for the same reason but kept visually silent (`sr-only`) — sighted users get nothing, screen
 * reader users get a quiet "Connected." confirmation once reconnection resolves.
 */
export function ConnectionBanner({ connection }: { readonly connection: ConnectionStatus }) {
  const isLive = connection === "live";
  return (
    <p aria-live="polite" className={isLive ? "sr-only" : "text-sm text-text-muted"}>
      {isLive ? COPY.live : <Badge tone="warning">{COPY[connection]}</Badge>}
    </p>
  );
}

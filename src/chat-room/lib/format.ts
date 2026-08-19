import { CHAT_ROOM_CONFIG } from "../config";

/**
 * Display only. A message carries an ISO instant; a reader wants a clock time in their own
 * locale. An unparseable value is shown verbatim rather than as "Invalid Date" — the server
 * always sends a real timestamp, so this is a defensive floor, not an expected path.
 */
export function formatChatTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleTimeString(undefined, CHAT_ROOM_CONFIG.timeFormat);
}

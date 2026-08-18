/** Every tunable the chat surface's components need. No component may inline one of these. */
export const CHAT_ROOM_CONFIG = {
  /** Wall-clock stamp beside a message. Locale comes from the browser, never a hardcoded one. */
  timeFormat: { hour: "numeric", minute: "2-digit" },
} as const;

/** Every tunable the chat surface's components need. No component may inline one of these. */
export const CHAT_ROOM_CONFIG = {
  /** Wall-clock stamp beside a message. Locale comes from the browser, never a hardcoded one. */
  timeFormat: { hour: "numeric", minute: "2-digit" },
  /**
   * How long `GifPicker` waits after the last keystroke before firing a search — one request per
   * pause in typing, not one per character. Lives here (UI config, browser-safe) rather than in
   * `@/gifs/config` (`GIF_CONFIG`): chat-room may only TYPE-import `@/gifs` (see `eslint.config.mjs`'s
   * client-boundary ban), and this tunable has to be a runtime VALUE a component reads.
   */
  gifSearchDebounceMs: 300,
} as const;

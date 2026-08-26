export interface PracticeBannerProps {
  /**
   * `MOCK_COPY.practiceBanner`, forwarded as a prop from `DraftRoom` (which reads it off
   * `room.mock.practiceBanner`, the API route's own answer) — this component never imports
   * `@/mock-draft` itself. The client boundary (`eslint.config.mjs`'s
   * `SERVER_ONLY_MODULE_GROUPS`) blocks every `src/draft-room/**` file from that value import;
   * see `MockRoomInfo`'s own docblock (`../contract`) for the full argument.
   */
  readonly message: string;
}

/**
 * The room's own honest header strip for a mock draft (Task 8, Step 2): quiet, ink-only chrome
 * — rule 1 spends color on money and live states only, and a practice room is neither. `DraftRoom`
 * mounts this only when `room.mock !== null`, for the whole life of the room; a real draft never
 * renders it, and has no branch of its own to hide it behind.
 */
export function PracticeBanner({ message }: PracticeBannerProps) {
  return (
    <div
      data-testid="practice-banner"
      className="shrink-0 border-b border-line bg-surface-elevated px-4 py-1.5 text-center text-xs text-text-muted"
    >
      {message}
    </div>
  );
}

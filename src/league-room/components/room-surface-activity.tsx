import type { ActivityRow } from "@/integrity/activity-view";
import type { PlatformNoticeView } from "../contract";
import { ActivityFeed } from "./activity-feed";

export interface RoomSurfaceActivityProps {
  readonly leagueId: string;
  readonly rows: readonly ActivityRow[];
  readonly nextBefore: number | null;
  /** The viewer's own platform notices for this league — loaded only on the activity route. */
  readonly notices: readonly PlatformNoticeView[];
}

/** The activity surface at any drawer height — the same feed the activity route serves, seeded
 *  with the first page the room already loaded. Older pages paginate by link, as ever. */
export function RoomSurfaceActivity({ leagueId, rows, nextBefore, notices }: RoomSurfaceActivityProps) {
  return (
    <div className="flex flex-col gap-3">
      {notices.length === 0 ? null : (
        <section className="flex flex-col gap-2" aria-label="What the platform did">
          <h3 className="text-lg font-medium text-text-primary">What the platform did</h3>
          <ul className="flex flex-col">
            {notices.map((notice) => (
              <li key={notice.id} className="flex flex-col gap-1 border-b border-line py-3 last:border-b-0">
                <p className="break-words font-medium text-text-primary">{notice.title}</p>
                <p className="break-words text-sm text-text-muted">{notice.body}</p>
                {notice.quote === null ? null : (
                  <blockquote className="break-words border-l-2 border-line pl-3 text-sm italic text-text-muted">{`"${notice.quote}"`}</blockquote>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-sm text-text-faint">
        Lineup changes appear only in your own history. Nobody else in this league can see them.
      </p>
      <ActivityFeed rows={rows} leagueId={leagueId} nextBefore={nextBefore} />
    </div>
  );
}

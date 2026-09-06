import { MICRO_LABEL } from "@/components/ui/config";
import type { PlayerSeasonBody } from "@/league-service/player";

/** Newest headlines that name him — shared by the peek and the full page (dossier plan, Task 6)
 *  so the identical list, with the identical link styling, renders from one component rather than
 *  two that could drift. `[]` renders nothing, never an empty "News" heading over a blank list. */
export function NewsList({ news }: { readonly news: PlayerSeasonBody["news"] }) {
  if (news.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className={`${MICRO_LABEL} text-text-faint`}>News</h3>
      <ul className="flex flex-col gap-1.5">
        {news.map((story) => (
          <li key={story.link}>
            <a href={story.link} target="_blank" rel="noreferrer" className="text-sm text-text-primary underline hover:text-accent">
              {story.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

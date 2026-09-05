import type { ReactNode } from "react";
import { DraftQueryProvider } from "@/draft-hq/query-provider";

/**
 * The `/app/draft` segment's own layout — adds nothing visually (the parent `(shell)` layout
 * already renders the rail and top bar); its one job is mounting `DraftQueryProvider` around
 * every page in this segment, so the Simulator (Task 3) and any later draft-HQ page that adopts
 * TanStack Query share one client. See `query-provider.tsx`'s own docblock for why the scope
 * stops at this segment rather than the whole app.
 */
export default function DraftSegmentLayout({ children }: { readonly children: ReactNode }) {
  return <DraftQueryProvider>{children}</DraftQueryProvider>;
}

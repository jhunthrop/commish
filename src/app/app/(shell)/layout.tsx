import type { ReactNode } from "react";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { AppShell } from "@/components/app-shell/app-shell";
import { createSheetDefaults, shellData } from "@/components/app-shell/shell-data";

export const dynamic = "force-dynamic";

/**
 * The signed-in shell, rendered ONCE for every page under this route group (ruling 8, as
 * amended by the UX coherence review, F8). Calls `shellData` exactly once per navigation and
 * renders `AppShell` around `children` — every page below this layout drops its own `<TopBar/>`
 * and its own `mx-auto max-w-4xl` wrapper, because this is now the thing that renders both.
 *
 * `(shell)` is a ROUTE GROUP, not a segment: it changes no URL. It exists so three sibling
 * surfaces under `/app` — the draft room, the TV board (already outside `/app`), and
 * `/app/join/[code]` — can DECLINE this layout by living in `(room)`/`(public)` groups instead.
 * A page-rendered shell (the original, now-reversed ruling 8) would mean `/app/loading.tsx`
 * suspends the rail and the top bar along with the content on every intra-app navigation; a
 * layout means only the content column inside `<main>` ever suspends.
 */
export default async function ShellLayout({ children }: { readonly children: ReactNode }) {
  const user = await requireCurrentUser();
  const db = getDb();
  const { rail, liveState } = await shellData(db, user);

  return (
    <AppShell
      user={{ displayName: user.displayName, avatar: user.avatarUrl, isAdmin: user.isAdmin }}
      rail={rail}
      liveState={liveState}
      createDefaults={createSheetDefaults()}
    >
      {children}
    </AppShell>
  );
}

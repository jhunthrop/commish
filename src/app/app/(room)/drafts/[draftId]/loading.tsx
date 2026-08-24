import { AppShellSkeleton } from "@/components/app-shell/app-shell-skeleton";

/**
 * The room renders no shell (`DraftRoomPage`'s own docblock: the `(room)` group DECLINES
 * `(shell)/layout.tsx` entirely), so this is the room's own frame while its draft state and
 * player pool load — the room's bands, not the signed-in shell's. Inheriting the shell's
 * skeleton here would draw a rail for the length of the fetch that the room then deletes the
 * moment it renders for real.
 */
export default function DraftRoomLoading() {
  return <AppShellSkeleton shape="room" />;
}

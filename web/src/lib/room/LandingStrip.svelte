<script lang="ts">
	import { pickLabel } from '#lib/format/draft.ts';
	import PickStrip from '#lib/ui/PickStrip.svelte';
	import type { StripPick } from '#lib/types/room.ts';
	import { type LobbyPick, type LobbySeatState, pickCredit } from './lobby.ts';
	import type { Board } from './model.ts';

	interface Props {
		/** The last round of picks, newest first. */
		picks: readonly LobbyPick[];
		board: Board;
		seats: ReadonlyMap<number, LobbySeatState>;
		you: number;
		teams: number;
	}

	let { picks, board, seats, you, teams }: Props = $props();

	/** The count and the names beside it are on one basis: a pick is a person's only when his own
	 * hand made it, and only then does the strip name him alone. */
	const people = $derived(picks.filter((p) => p.by === 'drafter').length);

	const strip = $derived(
		picks.flatMap((pick, i): StripPick[] => {
			const player = board.byId.get(pick.player_id);
			return player
				? [
						{
							key: pick.pick,
							player,
							lines: [pickCredit(pick, seats, you), pickLabel(pick.pick, teams)],
							ring: i === 0 ? 'ink' : undefined,
							strong: pick.by === 'drafter'
						}
					]
				: [];
		})
	);
</script>

<!-- Picks as they land: in a room with people, what others take is the room. -->
{#if picks.length > 0}
	<PickStrip
		lead={pickLabel(picks[0]?.pick ?? 1, teams)}
		leadLines={['just taken, newest first', `${people} of the last ${picks.length} by people`]}
		picks={strip}
		width="md"
	/>
{/if}

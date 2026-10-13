<script lang="ts">
	import { DEFAULT_TEAMS, pickLabel } from '#lib/format/draft.ts';
	import type { WentPick } from '#lib/types/room.ts';
	import PickStrip from './PickStrip.svelte';

	interface Props {
		/** Your last pick, the overall number. */
		since: number;
		/** Every pick after yours up to now, oldest first. */
		went: readonly WentPick[];
		teams?: number;
	}

	let { since, went, teams = DEFAULT_TEAMS }: Props = $props();

	const fromQueue = $derived(went.filter((pick) => pick.queued).length);
</script>

<PickStrip
	lead={String(went.length)}
	leadLines={[
		`went since your pick at ${pickLabel(since, teams)}`,
		`${fromQueue === 0 ? 'none' : fromQueue} from your queue`
	]}
	picks={went.map(({ player, pick, queued }) => ({
		key: pick,
		player,
		lines: [`${pickLabel(pick, teams)}${queued ? ' · queued' : ''}`],
		ring: queued ? 'accent' : undefined
	}))}
/>

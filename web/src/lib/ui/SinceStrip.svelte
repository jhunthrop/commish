<script lang="ts">
	import { DEFAULT_TEAMS, pickLabel } from '#lib/format/draft.ts';
	import type { WentPick } from '#lib/types/room.ts';
	import Panel from './Panel.svelte';
	import PickStrip from './PickStrip.svelte';

	interface Props {
		/** Your last pick, the overall number; null before your first, when the strip is everything
		 * that went before it. */
		since: number | null;
		/** Every pick after yours up to now, oldest first. */
		went: readonly WentPick[];
		teams?: number;
		/** Whose draft the strip is told for: your own, or a draft someone shared with you. */
		whose?: 'your' | 'their';
		/** The room keeps a queue: off for a draft followed on another host, which has none here. */
		queue?: boolean;
	}

	let { since, went, teams = DEFAULT_TEAMS, whose = 'your', queue = true }: Props = $props();

	const fromQueue = $derived(went.filter((pick) => pick.queued).length);
	const lead = $derived(
		since === null
			? `went before ${whose} first pick`
			: `went since ${whose} pick at ${pickLabel(since, teams)}`
	);
</script>

<!-- No pick landed between two of yours: one line says so, where a strip would sit. -->
{#if since !== null && went.length === 0}
	<Panel padding="none">
		<p class="straight">{whose === 'your' ? 'Your' : 'Their'} turn came straight back</p>
	</Panel>
{:else}
	<PickStrip
		lead={String(went.length)}
		leadLines={queue
			? [lead, `${fromQueue === 0 ? 'none' : fromQueue} from ${whose} queue`]
			: [lead]}
		picks={went.map(({ player, pick, queued }) => ({
			key: pick,
			player,
			lines: queued ? [pickLabel(pick, teams), 'queued'] : [pickLabel(pick, teams)],
			ring: queued ? 'accent' : undefined
		}))}
	/>
{/if}

<style>
	.straight {
		display: flex;
		align-items: center;
		min-block-size: var(--pick-line-h);
		box-sizing: border-box;
		margin: 0;
		padding: 0 var(--s-4);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>

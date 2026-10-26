<script lang="ts">
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import Figure from '#lib/ui/Figure.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { Companion } from './api.ts';
	import {
		draftName,
		draftOnWords,
		hostDraftUrl,
		openDraftWords,
		pickCount,
		picksMadeWords,
		staleWords,
		turnWords
	} from './model.ts';

	/** The companion's head: the host's pick count where a mock room's clock would be (we never show
	 * a clock we do not own), when you are up, and the way back to the draft on Sleeper. */
	interface Props {
		companion: Companion;
		/** The league line: "12 teams · PPR · slot 5". */
		league: string;
	}

	let { companion: c, league }: Props = $props();

	const stale = $derived(staleWords(c));
</script>

<Panel
	as="section"
	label={draftOnWords(c.host)}
	padding="sm"
	edge={c.your_turn ? 'accent' : undefined}
>
	<div class="bar">
		<Figure value={pickCount(c)} size="lg" caption={picksMadeWords(c.host)} />
		<div class="what">
			<DisplayTitle size="section">{draftName(c)}</DisplayTitle>
			<p class="league">{league}</p>
			<p class="turn" class:on={c.your_turn}>{turnWords(c)}</p>
			{#if stale}<p class="stale" role="status">{stale}</p>{/if}
		</div>
		<div class="act">
			<Quiet href={hostDraftUrl(c)} size="sm">{openDraftWords(c.host)}</Quiet>
		</div>
	</div>
</Panel>

<style>
	.bar {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--s-5);
		align-items: center;
	}

	.what {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		min-width: 0;
	}

	.league,
	.turn,
	.stale {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.turn.on {
		color: var(--accent-text);
		font-weight: 600;
	}

	.stale {
		color: var(--loss-ink);
	}

	@media (max-width: 760px) {
		.bar {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-3);
		}
	}
</style>

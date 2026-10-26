<script lang="ts">
	import type { FactCell } from '#lib/ui/facts.ts';
	import Menu from '#lib/ui/Menu.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { MOCK, autopickWords, pickHead } from './mock-words.ts';

	interface Props {
		/** The pick on the clock. */
		now: number;
		/** The round, the league, your slot and your next pick as cells (words.ts pickBarCells). */
		cells: readonly FactCell[];
		teams: number;
		/** The round "Pick for me" drafts through. */
		autopickTo: number;
		canUndo: boolean;
		busy: boolean;
		/** Set for a moment after the link is copied. */
		copied: boolean;
		onundo: () => void;
		onautopick: () => void;
		onfinish: () => void;
		onshare: () => void;
	}

	let {
		now,
		cells,
		teams,
		autopickTo,
		canUndo,
		busy,
		copied,
		onundo,
		onautopick,
		onfinish,
		onshare
	}: Props = $props();
</script>

<div class="bar">
	<b class="pick">{pickHead(now, teams)}</b>
	<dl class="cells" aria-label="This pick">
		{#each cells as cell (cell.label)}
			<div>
				<dt>{cell.label}</dt>
				<dd class:word={cell.word}>{cell.value}</dd>
			</div>
		{/each}
	</dl>
	<!-- On the phone Undo stays out and the rest fold into More, so the strip and our call come
		 first. -->
	<div class="acts">
		<Quiet key="U" disabled={!canUndo || busy} onclick={onundo}>{MOCK.undo}</Quiet>
		<span class="spread">{@render more()}</span>
		<span class="folded"><Menu label={MOCK.more} id="room-more">{@render more()}</Menu></span>
	</div>
</div>

{#snippet more()}
	<Quiet disabled={busy} onclick={onautopick}>{autopickWords(autopickTo)}</Quiet>
	<Quiet disabled={busy} onclick={onfinish}>{MOCK.finish}</Quiet>
	<Quiet onclick={onshare}>{copied ? MOCK.copied : MOCK.share}</Quiet>
{/snippet}

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-3) var(--s-4);
		min-height: 48px;
	}

	.pick {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		font-size: var(--t-head);
		line-height: 1;
		text-transform: uppercase;
	}

	.cells {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-1) var(--s-4);
		margin: 0;
	}

	.cells div {
		display: flex;
		flex-direction: column-reverse;
	}

	dt {
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
	}

	dd {
		margin: 0;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: var(--t-xl);
		line-height: 1;
	}

	dd.word {
		font-family: var(--font-ui);
		font-size: var(--t-md);
		font-weight: 600;
		line-height: 1.6rem;
	}

	.acts {
		margin-left: auto;
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-2);
	}

	.spread {
		display: contents;
	}

	.folded {
		display: none;
	}

	@media (max-width: 760px) {
		.acts {
			margin-left: 0;
			width: 100%;
			flex-wrap: nowrap;
		}

		.spread {
			display: none;
		}

		.folded {
			display: inline-flex;
		}
	}
</style>

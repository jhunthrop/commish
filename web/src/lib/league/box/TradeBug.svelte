<script lang="ts">
	import type { Snippet } from 'svelte';
	import TeamAvatar from './TeamAvatar.svelte';
	import { TRADES, type BugFigures } from './trades.ts';

	/** The trade builder's scoreboard (Lane 66g), lit like the Matchup's bug: each side's this-week
	 * Proj and rest-of-season strength before and after the trade with the change, a bar of its gain
	 * against the other side's (Lane 260), and its room; the verb between them. */
	interface Side {
		name: string;
		figures: BugFigures;
		room: string;
		/** The side's gain as a share of the longer one, 0 to 1 (gainBars). */
		bar: number;
	}

	interface Props {
		yours: Side;
		theirs: Side;
		/** The verb and its line, between the sides. */
		verb: Snippet;
		/** The head over each side's gain, Gain a week (TRADES.gainHead). */
		gainHead: string;
	}

	let { yours, theirs, verb, gainHead }: Props = $props();
</script>

{#snippet half(side: Side, mine: boolean)}
	<div class="half" class:mine>
		<span class="who"
			><TeamAvatar name={side.name} size={26} me={mine} board /><span
				><small>{mine ? TRADES.yourSide : TRADES.theirSide}</small><b>{side.name}</b></span
			></span
		>
		<span class="fig"
			><small>{TRADES.weekHead}</small><span
				><i>{side.figures.projBefore}</i><span class="to">{TRADES.to}</span><b
					>{side.figures.projAfter}</b
				><em class={side.figures.projTone}>{side.figures.projChange}</em></span
			></span
		>
		<span class="fig"
			><small>{gainHead}</small><span
				><i>{side.figures.seasonBefore}</i><span class="to">{TRADES.to}</span><b
					>{side.figures.seasonAfter}</b
				><em class={side.figures.seasonTone}>{side.figures.seasonChange}</em></span
			></span
		>
		<span class="room"><small>{TRADES.room}</small><span>{side.room}</span></span>
		<span class="bar {side.figures.seasonTone}" aria-hidden="true"
			><span style:width="{String(Math.round(side.bar * 100))}%"></span></span
		>
	</div>
{/snippet}

<div class="bug">
	{@render half(yours, true)}
	<div class="mid">{@render verb()}</div>
	{@render half(theirs, false)}
</div>

<style>
	.bug {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		border-radius: var(--r-md);
		overflow: hidden;
		background: var(--scoreboard);
		color: var(--scoreboard-ink);
	}

	.half {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: end;
		gap: var(--s-2) var(--s-5);
		padding: var(--s-3) var(--s-4);
		min-width: 0;
	}

	.half:not(.mine) {
		border-left: 1px solid var(--scoreboard-line);
	}

	.who {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.who > span {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.who b {
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	small {
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--scoreboard-ink-2);
		white-space: nowrap;
	}

	.fig,
	.room {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.fig > span {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	i {
		font-style: normal;
		font-size: var(--t-lg);
		font-weight: 600;
		color: var(--scoreboard-ink-2);
	}

	.to {
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		color: var(--scoreboard-ink-2);
	}

	b {
		font-size: var(--t-xl);
		font-weight: 800;
	}

	.mine .fig b {
		color: var(--scoreboard-num);
	}

	em {
		font-style: normal;
		font-size: var(--t-md);
		font-weight: 700;
		padding: 0 5px;
		border-radius: var(--r-sm);
		color: var(--scoreboard-ink-2);
	}

	/* The board's own gain and loss washes, the same in both themes. */
	em.gain {
		background: var(--scoreboard-gain-bg);
		color: var(--scoreboard-gain-ink);
	}

	em.loss {
		background: var(--scoreboard-loss-bg);
		color: var(--scoreboard-loss-ink);
	}

	/* Each side's gain as a bar, the longer side full, in the board's gain and loss inks. */
	.bar {
		grid-column: 1 / -1;
		height: 6px;
		border-radius: 3px;
		background: var(--scoreboard-line);
		overflow: hidden;
	}

	.bar > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--scoreboard-ink-2);
		transition: width 160ms ease-out;
	}

	.bar.gain > span {
		background: var(--scoreboard-gain-ink);
	}

	.bar.loss > span {
		background: var(--scoreboard-loss-ink);
	}

	@media (prefers-reduced-motion: reduce) {
		.bar > span {
			transition: none;
		}
	}

	.room > span {
		font-size: var(--t-sm);
		font-weight: 600;
		white-space: nowrap;
	}

	.mid {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: var(--s-2) var(--s-3);
		background: var(--scoreboard-2);
		border-left: 1px solid var(--scoreboard-line);
		max-width: 220px;
		font-size: var(--t-xs);
		color: var(--scoreboard-ink-2);
		text-align: center;
	}

	.mid :global(a:not(.action)) {
		color: var(--scoreboard-ink);
	}

	@media (max-width: 1180px) {
		.bug {
			grid-template-columns: minmax(0, 1fr);
		}

		.half:not(.mine) {
			border-left: 0;
			border-top: 1px solid var(--scoreboard-line);
		}

		.mid {
			order: 3;
			max-width: none;
			border-left: 0;
			border-top: 1px solid var(--scoreboard-line);
		}
	}

	@media (max-width: 760px) {
		.half {
			grid-template-columns: auto auto;
			gap: var(--s-2) var(--s-3);
			padding: var(--s-2) var(--s-3);
		}

		.room {
			display: none;
		}

		b {
			font-size: var(--t-lg);
		}

		i {
			font-size: var(--t-md);
		}

		em {
			font-size: var(--t-sm);
		}

		/* The verb is pinned under the builder on a phone. */
		.mid {
			display: none;
		}
	}
</style>

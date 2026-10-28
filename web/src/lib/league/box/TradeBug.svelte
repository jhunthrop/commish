<script lang="ts">
	import type { Snippet } from 'svelte';
	import TeamAvatar from './TeamAvatar.svelte';
	import { TRADES, type BugFigures } from './trades.ts';

	/** The trade builder's verdict (Lane 66g; box-score rows since Lane 268): one row per side, its
	 * name in body weight, then this week's Proj and the rest-of-season gain a week, each before to
	 * after with the change, a bar of its gain against the other side's (Lane 260), and its room; the
	 * verb beside the rows. Each row has room for one more cell after Room (the value cell Lane 269's
	 * answer brings): a head and a cell, the table's auto columns take it. */
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
		/** The verb and its line, beside the rows. */
		verb: Snippet;
		/** The head over each side's gain, Gain a week (TRADES.gainHead). */
		gainHead: string;
		/** The head over the sides' names, for a screen reader: "Team". */
		teamHead: string;
	}

	let { yours, theirs, verb, gainHead, teamHead }: Props = $props();
</script>

{#snippet row(side: Side, mine: boolean)}
	<tr class:mine>
		<th scope="row" class="who"
			><span class="who-in"
				><TeamAvatar name={side.name} size={20} me={mine} /><small
					>{mine ? TRADES.yourSide : TRADES.theirSide}</small
				><span class="name">{side.name}</span></span
			></th
		>
		<td class="fig"
			><span class="figs"
				><i>{side.figures.projBefore}</i><span class="to">{TRADES.to}</span><b
					>{side.figures.projAfter}</b
				><em class={side.figures.projTone}>{side.figures.projChange}</em></span
			></td
		>
		<td class="fig"
			><span class="figs"
				><i>{side.figures.seasonBefore}</i><span class="to">{TRADES.to}</span><b
					>{side.figures.seasonAfter}</b
				><em class={side.figures.seasonTone}>{side.figures.seasonChange}</em><span
					class="bar {side.figures.seasonTone}"
					aria-hidden="true"><span style:width="{String(Math.round(side.bar * 100))}%"></span></span
				></span
			></td
		>
		<td class="room">{side.room}</td>
	</tr>
{/snippet}

<div class="bug">
	<table>
		<thead>
			<tr>
				<th scope="col"><span class="vh">{teamHead}</span></th>
				<th scope="col">{TRADES.weekHead}</th>
				<th scope="col">{gainHead}</th>
				<th scope="col" class="room">{TRADES.room}</th>
			</tr>
		</thead>
		<tbody>
			{@render row(yours, true)}
			{@render row(theirs, false)}
		</tbody>
	</table>
	<div class="mid">{@render verb()}</div>
</div>

<style>
	.bug {
		display: flex;
		align-items: center;
		gap: var(--s-4);
		min-width: 0;
	}

	table {
		flex: 1;
		min-width: 0;
		border-collapse: collapse;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 0 var(--s-3) 0 0;
		text-align: left;
		white-space: nowrap;
	}

	thead th {
		height: 14px;
		line-height: 14px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	tbody tr {
		height: 24px;
	}

	tbody tr + tr {
		border-top: 1px solid var(--line);
	}

	.who {
		width: 1%;
		max-width: 22rem;
		font-weight: 500;
	}

	.who-in {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	small {
		flex: none;
		width: 2.6em;
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
	}

	.mine small {
		color: var(--accent-text);
	}

	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--t-sm);
	}

	.figs {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
		font-family: var(--font-num);
	}

	i {
		font-style: normal;
		font-size: var(--t-md);
		font-weight: 600;
		color: var(--ink-3);
	}

	.to {
		font-family: var(--font-ui);
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	b {
		font-size: var(--t-md);
		font-weight: 700;
	}

	em {
		font-style: normal;
		font-size: var(--t-sm);
		font-weight: 700;
		padding: 0 5px;
		border-radius: var(--r-sm);
		color: var(--ink-2);
	}

	em.gain {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	em.loss {
		background: var(--loss-bg);
		color: var(--loss-ink);
	}

	/* Each side's gain as a short bar, the longer side full, in the gain and loss inks. */
	.bar {
		align-self: center;
		width: 56px;
		height: 6px;
		border-radius: 3px;
		background: var(--line);
		overflow: hidden;
	}

	.bar > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--ink-3);
		transition: width 160ms ease-out;
	}

	.bar.gain > span {
		background: var(--gain-ink);
	}

	.bar.loss > span {
		background: var(--loss-ink);
	}

	@media (prefers-reduced-motion: reduce) {
		.bar > span {
			transition: none;
		}
	}

	.room {
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
	}

	thead .room {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.mid {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		max-width: 21rem;
		font-size: var(--t-xs);
		color: var(--ink-2);
		text-align: right;
	}

	.vh {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* The verb is pinned under the builder wherever the rosters stack (fix round 2), so one verb
	   shows. */
	@media (max-width: 1180px) {
		.mid {
			display: none;
		}
	}

	@media (max-width: 760px) {
		.room {
			display: none;
		}

		.bar {
			width: 28px;
		}

		th,
		td {
			padding-right: var(--s-2);
		}

		/* The team's name whole, on a second line where it is long, never cut. */
		.who {
			width: 7.5rem;
			white-space: normal;
		}

		.who-in {
			align-items: flex-start;
			flex-wrap: wrap;
			column-gap: 4px;
		}

		.name {
			flex-basis: 100%;
			overflow: visible;
			overflow-wrap: anywhere;
			line-height: 1.2;
		}

		tbody tr {
			height: auto;
		}

		tbody th,
		tbody td {
			padding-block: 3px;
		}

		.figs {
			gap: 4px;
		}

		i,
		b {
			font-size: var(--t-sm);
		}

		em {
			font-size: var(--t-xs);
		}
	}
</style>

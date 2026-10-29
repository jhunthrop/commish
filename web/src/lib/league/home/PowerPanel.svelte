<script lang="ts">
	import TeamAvatar from '../box/TeamAvatar.svelte';
	import { FIGURE_WORDS, type PowerPanel } from './figures.ts';

	/** The power panel (Lane 292) as a box score: one row a team in overall order, its overall place
	 * (Pwr) and its place at each starting spot the league starts, the drafter's row tinted; the API's
	 * one sentence under it says what the places rank and over which weeks. */
	interface Props {
		panel: PowerPanel;
	}

	let { panel }: Props = $props();
</script>

<section class="power" aria-label={FIGURE_WORDS.power}>
	<h2>{FIGURE_WORDS.power}</h2>
	<table data-figure="power">
		<thead>
			<tr>
				<th class="tm" scope="col">{FIGURE_WORDS.team}</th>
				<th class="n pw" scope="col">{FIGURE_WORDS.overall}</th>
				{#each panel.heads as head (head)}<th class="n" scope="col">{head}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each panel.rows as row (row.rosterId)}
				<tr class:me={row.me}>
					<td class="tm">
						<span class="tmw">
							<TeamAvatar name={row.name} size={22} me={row.me} src={row.avatar} />
							<b>{row.name}</b>
						</span>
					</td>
					<td class="n pw">{row.rank}</td>
					{#each row.ranks as rank, i (i)}<td class="n" class:top={rank === 1}>{rank}</td>{/each}
				</tr>
			{/each}
		</tbody>
	</table>
	<p class="basis" data-basis="power">{panel.basis}</p>
</section>

<style>
	h2 {
		margin: 0 0 var(--s-2);
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 0 var(--s-2);
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: middle;
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	thead th {
		height: 30px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
		white-space: nowrap;
	}

	tbody tr {
		height: 36px;
	}

	.n {
		width: 44px;
		text-align: right;
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-md);
	}

	thead .n {
		font-family: inherit;
		font-size: var(--t-xs);
	}

	td.pw {
		font-size: var(--t-lg);
		color: var(--ink);
	}

	td.top {
		color: var(--gain-ink);
	}

	.tmw {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.tmw b {
		font-size: var(--t-sm);
		font-weight: 600;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	td.tm {
		max-width: 0;
		width: 100%;
	}

	tr.me td {
		background: var(--accent-wash);
	}

	tr.me td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.basis {
		margin: var(--s-2) 0 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
		line-height: 1.5;
	}

	@media (max-width: 760px) {
		th,
		td {
			padding: 0 4px;
		}

		.n {
			width: 32px;
			font-size: var(--t-sm);
		}

		td.pw {
			font-size: var(--t-md);
		}

		.basis {
			font-size: var(--t-xs);
			line-height: 1.45;
		}
	}
</style>

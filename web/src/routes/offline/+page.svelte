<script lang="ts">
	import { dayLabel } from '#lib/format/date.ts';
	import { fixed } from '#lib/format/number.ts';
	import Footnote from '#lib/ui/Footnote.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Offline · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="offline">
	<p class="lead">
		You're offline, so this is the last board this device saved, from the run of {dayLabel(
			data.runAt
		)}.
	</p>
	<Footnote>{data.basis}</Footnote>
	<table class="board">
		<caption>{data.format.label} board, top {data.rows.length}</caption>
		<thead>
			<tr>
				<th scope="col" class="num">#</th>
				<th scope="col">Player</th>
				<th scope="col">Pos</th>
				<th scope="col">Team</th>
				<th scope="col" class="num">{data.format.unit}</th>
			</tr>
		</thead>
		<tbody>
			{#each data.rows as row (row.rank)}
				<tr>
					<td class="num">{row.rank}</td>
					<td class="name">{row.name}</td>
					<td><PositionPill position={row.position} rank={row.positionRank} /></td>
					<td class="team">{row.team}</td>
					<td class="num">{fixed(row.projected)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</main>

<style>
	.offline {
		max-width: 720px;
		margin: 0 auto;
		padding: var(--s-6) var(--s-5);
		display: flex;
		flex-direction: column;
		gap: var(--s-5);
	}

	.lead {
		margin: 0;
		font-size: var(--t-lg);
		color: var(--ink);
	}

	.board {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--t-md);
	}

	caption {
		text-align: left;
		padding-bottom: var(--s-2);
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
	}

	th {
		text-align: left;
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
		padding: var(--s-2);
		border-bottom: 1px solid var(--line-strong);
	}

	td {
		padding: var(--s-2);
		border-bottom: 1px solid var(--line);
		color: var(--ink-2);
	}

	.name {
		color: var(--ink);
		font-weight: 600;
	}

	.team {
		color: var(--ink-3);
	}

	.num {
		text-align: right;
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 760px) {
		.offline {
			padding: var(--s-5) var(--s-4);
		}
	}
</style>

<script lang="ts">
	import Face from '#lib/ui/Face.svelte';
	import { clubMark } from '#lib/ui/club-mark.ts';
	import TeamAvatar from '../box/TeamAvatar.svelte';
	import MoveMark from '../box/MoveMark.svelte';
	import { headshotUrlFor } from '#lib/ui/headshot-provider.ts';
	import { HOME, type FeedPlayer, type FeedRow } from './home.ts';

	/** The league's moves as a feed table (Lane 66i): this week's and last week's, newest first, each
	 * with its day and time, its team (both in a trade), the kind of move, the players in and out
	 * with their faces, and a claim's bid. The drafter's own moves are tinted. On a phone each move
	 * stacks: the kind, the team and the time, then its players. */
	interface Props {
		rows: readonly FeedRow[];
		/** Said in place of the rows when the league has no moves this week or last. */
		none: string;
	}

	let { rows, none }: Props = $props();

	function faceSrc(p: FeedPlayer): string | null {
		if (p.position === 'D/ST') return clubMark(p.club);
		return p.boardId === null ? null : headshotUrlFor(p.boardId);
	}
</script>

{#snippet player(p: FeedPlayer, move: 'in' | 'out' | null)}
	<span class="mp" class:out={move === 'out'}>
		{#if move}<MoveMark {move} size={16} />{/if}
		<Face src={faceSrc(p)} name={p.name} size={22} />
		<b>{p.name}</b>
		<small>{p.club} {p.position}</small>
		{#if p.to}<span class="to">to {p.to}</span>{/if}
	</span>
{/snippet}

<section class="moves" aria-label={HOME.moves}>
	<div class="head">
		<h2>{HOME.moves}</h2>
		<span>{HOME.movesAside}</span>
	</div>
	<table class="feed">
		<thead>
			<tr>
				<th class="when" scope="col">{HOME.when}</th>
				<th class="who" scope="col">{HOME.team}</th>
				<th class="kind" scope="col">{HOME.move}</th>
				<th scope="col">{HOME.players}</th>
				<th class="det" scope="col">{HOME.detail}</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.key)}
				<tr class:me={row.mine}>
					<td class="when">{row.when}</td>
					<td class="who">
						{#each row.teams as team (team.rosterId)}
							<span class="mt"
								><TeamAvatar name={team.name} size={24} me={team.me} src={team.avatar} /><b
									>{team.name}</b
								></span
							>
						{/each}
					</td>
					<td class="kind"><span class="chip" class:trade={row.trade}>{row.kind}</span></td>
					<td class="pls">
						<span class="pw">
							{#each row.adds as p (p.key)}{@render player(p, row.trade ? null : 'in')}{/each}
							{#each row.drops as p (p.key)}{@render player(p, 'out')}{/each}
						</span>
					</td>
					<td class="det">{row.detail}</td>
				</tr>
			{:else}
				<tr><td class="none" colspan="5">{none}</td></tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	.head {
		display: flex;
		align-items: baseline;
		gap: var(--s-3);
		margin: 0 0 var(--s-2);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
	}

	.head span {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.feed {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		overflow: hidden;
	}

	th,
	td {
		padding: 0 var(--s-2);
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: middle;
	}

	thead th {
		height: 32px;
		font-size: var(--t-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-3);
		background: var(--bg);
		white-space: nowrap;
	}

	tbody tr {
		height: 50px;
	}

	.when {
		width: 118px;
		font-size: var(--t-sm);
		color: var(--ink-2);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.who {
		width: 250px;
	}

	.kind {
		width: 112px;
	}

	.det {
		width: 110px;
		text-align: right;
		font-size: var(--t-sm);
		color: var(--ink-2);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.mt {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
		padding-block: 2px;
	}

	.mt b {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		height: 22px;
		padding: 0 8px;
		border-radius: var(--r-sm);
		border: 1px solid var(--line-strong);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--ink-2);
		white-space: nowrap;
	}

	.chip.trade {
		color: var(--ink);
		border-color: var(--ink-3);
	}

	.pw {
		display: flex;
		flex-wrap: wrap;
		gap: 4px var(--s-4);
		padding-block: 6px;
	}

	.mp {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.mp b {
		font-weight: 600;
	}

	.mp.out b {
		font-weight: 500;
		color: var(--ink-2);
	}

	.mp small {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.to {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	tr.me td {
		background: var(--accent-wash);
	}

	tr.me td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	.none {
		height: 44px;
		color: var(--ink-3);
		font-size: var(--t-sm);
	}

	@media (max-width: 1000px) {
		.when,
		.who,
		.kind,
		.det {
			width: auto;
		}

		thead {
			display: none;
		}

		tbody tr {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			grid-template-areas: 'kind who when' 'pls pls pls' 'det det det';
			gap: 4px var(--s-2);
			height: auto;
			padding: var(--s-2) var(--s-3);
			border-bottom: 1px solid var(--line);
		}

		td {
			display: block;
			width: auto;
			border: 0;
			padding: 0;
		}

		.when {
			grid-area: when;
			font-size: var(--t-xs);
		}

		.who {
			grid-area: who;
			min-width: 0;
		}

		.kind {
			grid-area: kind;
		}

		.pls {
			grid-area: pls;
		}

		.det {
			grid-area: det;
			text-align: left;
			font-size: var(--t-xs);
		}

		.det:empty {
			display: none;
		}

		.pw {
			flex-direction: column;
			gap: 3px;
			padding: 0;
		}

		.mp {
			white-space: normal;
		}

		tr.me {
			background: var(--accent-wash);
			box-shadow: inset 3px 0 0 var(--accent);
		}

		tr.me td {
			background: transparent;
			box-shadow: none;
		}

		.none {
			grid-column: 1 / -1;
		}
	}
</style>

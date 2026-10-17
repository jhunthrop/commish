<script lang="ts">
	import { chanceShort } from '#lib/format/draft.ts';
	import { fixed, signed } from '#lib/format/number.ts';
	import { isMarketPosition } from '#lib/run/market.ts';
	import type { CallAction, CallRow } from '#lib/types/room.ts';
	import Face from './Face.svelte';
	import { holdHeight } from './hold-height.ts';
	import Panel from './Panel.svelte';
	import PositionPill from './PositionPill.svelte';
	import Quiet from './Quiet.svelte';
	import Verb from './Verb.svelte';

	/** Our call as a box score (Lane 66o): our top three as rows under the pool's own column heads,
	 * the call first in the accent with the one verb. No sentence restates what the cells say. */
	interface Props {
		/** Where the call stands: "Our call at 5.08". */
		tag: string;
		/** The call first, then the next two of our shortlist. */
		rows: readonly CallRow[];
		/** The chance column's head: "Still there 6.05", "Reaches 5.08"; null at your last pick, when
		 * there is no next turn to look to. */
		chanceHead: string | null;
		action: CallAction;
		/** Off your turn the call waits on the board: a quiet edge, and the action is quiet too. */
		waiting?: boolean;
		/** Set while the call for a new turn is on its way: "Reading the room for 2.12". The panel keeps
		 * the frame it last had as a quiet skeleton, so nothing below it moves, and its action waits. */
		reading?: string;
	}

	let { tag, rows, chanceHead, action, waiting = false, reading }: Props = $props();

	const quiet = $derived(waiting || reading !== undefined);
</script>

{#snippet verb(phone: boolean)}
	<span class="act" class:phone>
		{#if reading !== undefined}
			<Quiet size="lg" fill key={action.key} disabled>Waiting on the call</Quiet>
		{:else if waiting}
			<Quiet size="lg" fill key={action.key} onclick={action.onclick}>{action.label}</Quiet>
		{:else}
			<Verb size="lg" fill key={action.key} onclick={action.onclick}>{action.label}</Verb>
		{/if}
	</span>
{/snippet}

<Panel as="section" label={reading ?? tag} padding="none" edge={quiet ? 'quiet' : 'accent'}>
	<div
		class="call"
		class:waiting={quiet}
		class:reading={reading !== undefined}
		aria-busy={reading !== undefined}
		use:holdHeight
	>
		<span class="tag">{reading ?? tag}</span>
		<table>
			<thead>
				<tr>
					<th scope="col" class="who">Player</th>
					<th scope="col" class="proj">Projected</th>
					<th scope="col">Over repl</th>
					<th scope="col">ADP</th>
					{#if chanceHead !== null}<th scope="col">{chanceHead}</th>{/if}
					<th class="go"><span class="sr">Verb</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row, i (row.player.id)}
					{@const market = isMarketPosition(row.player.position)}
					<tr class:pick={i === 0}>
						<td class="who">
							<span class="p">
								<Face
									src={row.player.headshot}
									name={row.player.name}
									size={i === 0 ? 48 : 34}
									phoneSize={i === 0 ? 32 : 28}
									loading="eager"
								/>
								<span class="nm">
									<b>{row.player.name}</b>
									<small
										><PositionPill position={row.player.position} rank={row.player.positionRank} />
										{row.player.team}</small
									>
								</span>
							</span>
						</td>
						<td class="n proj">{row.projected === null ? '' : fixed(row.projected)}</td>
						{#if market}
							<td class="n muted">Draft order {row.player.positionRank}</td>
						{:else}
							<td class="n">{row.vor === null ? '' : signed(row.vor)}</td>
						{/if}
						<td class="n">{row.adp === null ? '' : fixed(row.adp)}</td>
						{#if chanceHead !== null}<td class="n"
								>{row.chance === null ? '' : chanceShort(row.chance)}</td
							>{/if}
						<td class="go"
							>{#if i === 0}{@render verb(false)}{/if}</td
						>
					</tr>
				{/each}
			</tbody>
		</table>
		{@render verb(true)}
	</div>
</Panel>

<style>
	.call {
		padding: var(--s-3) 0 0;
	}

	.tag {
		display: block;
		padding: 0 var(--s-4) var(--s-2);
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--accent-text);
	}

	.waiting .tag {
		color: var(--ink-3);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		font-variant-numeric: tabular-nums;
	}

	th {
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
		text-align: right;
		padding: 0 var(--s-3) var(--s-2);
		border-bottom: 1px solid var(--line-strong);
		white-space: nowrap;
	}

	/* The pool's widths, so the card's columns sit over the pool's. */
	th:nth-child(2) {
		width: 110px;
	}

	th:nth-child(3) {
		width: 110px;
	}

	th:nth-child(4) {
		width: 80px;
	}

	th:nth-child(5) {
		width: 150px;
	}

	th.go {
		width: 224px;
	}

	th.who,
	td.who {
		text-align: left;
	}

	td {
		padding: 0 var(--s-3);
		height: var(--row-h);
		border-bottom: 1px solid var(--line);
		text-align: right;
		white-space: nowrap;
	}

	tr:last-child td {
		border-bottom: 0;
	}

	td.n {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
		color: var(--ink-2);
	}

	td.muted {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.p {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-width: 0;
	}

	.nm {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.nm b {
		font-weight: 600;
		font-size: var(--t-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nm small {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	/* The call: the row in the accent, the name in the display face, the figures at their largest. */
	tr.pick td {
		background: var(--accent-wash);
		height: 72px;
	}

	.waiting tr.pick td {
		background: var(--surface-2);
	}

	tr.pick .nm b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-head);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	tr.pick td.n {
		font-size: var(--t-xl);
		color: var(--ink);
	}

	td.go {
		padding-right: var(--s-3);
	}

	.act {
		display: flex;
	}

	.act.phone {
		display: none;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	/* The skeleton: the last call's frame, every word a quiet block of the same size. */
	.reading :is(td.n, .nm b, .nm small) {
		color: transparent;
	}

	.reading :is(.nm b, td.n) {
		background-clip: content-box;
	}

	.reading .p :global(.face) {
		opacity: 0;
	}

	@media (max-width: 760px) {
		th,
		td {
			padding-inline: 4px;
		}

		th {
			font-size: 10px;
			letter-spacing: 0.02em;
			white-space: normal;
			vertical-align: bottom;
		}

		th.proj,
		td.proj,
		th.go,
		td.go {
			display: none;
		}

		th:nth-child(3) {
			width: 70px;
		}

		th:nth-child(4) {
			width: 48px;
		}

		th:nth-child(5) {
			width: 64px;
		}

		td.n {
			font-size: var(--t-md);
		}

		tr.pick td {
			height: 60px;
		}

		tr.pick .nm b {
			font-size: var(--t-lg);
			white-space: normal;
		}

		tr.pick td.n {
			font-size: var(--t-lg);
		}

		.nm b {
			font-size: var(--t-sm);
			white-space: normal;
			line-height: 1.15;
		}

		.nm small {
			font-size: var(--t-xs);
		}

		.act.phone {
			display: flex;
			padding: var(--s-3);
		}
	}
</style>

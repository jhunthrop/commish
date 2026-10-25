<script lang="ts">
	import { adpFigure, chanceShort } from '#lib/format/draft.ts';
	import { gapText, gapTone } from '#lib/format/gap.ts';
	import { signed } from '#lib/format/number.ts';
	import { isMarketPosition } from '#lib/run/market.ts';
	import type { CallAction, CallRow } from '#lib/types/room.ts';
	import Face from './Face.svelte';
	import { holdHeight } from './hold-height.ts';
	import Panel from './Panel.svelte';
	import PositionPill from './PositionPill.svelte';
	import Quiet from './Quiet.svelte';
	import Verb from './Verb.svelte';
	import { ROOM } from '#lib/room/words.ts';

	/** Our call as a box score (Lane 66o): our top three as rows on the pool's own grid, in the pool's
	 * column order and widths (face, player, Over repl, the chance, ADP, the verb), so each figure
	 * sits over the pool's column of it. The call is first, in the accent, with the one verb. No
	 * sentence restates what the cells say. */
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

{#snippet verb()}
	{#if reading !== undefined}
		<Quiet fill key={action.key} disabled>{ROOM.waitingOnCall}</Quiet>
	{:else if waiting}
		<Quiet fill key={action.key} onclick={action.onclick}>{action.label}</Quiet>
	{:else}
		<Verb fill key={action.key} onclick={action.onclick}>{action.label}</Verb>
	{/if}
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
		<div class="grid head" aria-hidden="true">
			<span></span>
			<span>{ROOM.player}</span>
			<span class="n">{ROOM.overRepl}</span>
			<span class="n">{chanceHead ?? ''}</span>
			<span class="n adp">{ROOM.adp}</span>
			<span class="n adp gapc">{ROOM.gap}</span>
			<span class="go"></span>
		</div>
		{#each rows as row, i (row.player.id)}
			{@const market = isMarketPosition(row.player.position)}
			<div class="grid row" class:pick={i === 0}>
				<span class="face"
					><Face
						src={row.player.headshot}
						name={row.player.name}
						size={40}
						phoneSize={32}
						loading="eager"
					/></span
				>
				<span class="nm">
					<b>{row.player.name}</b>
					<small
						><PositionPill position={row.player.position} rank={row.player.positionRank} />
						{row.player.team}</small
					>
				</span>
				{#if market}
					<span class="n muted">Draft order {row.player.positionRank}</span>
				{:else}
					<span class="n">{row.vor === null ? '' : signed(row.vor)}</span>
				{/if}
				<span class="n"
					>{chanceHead === null || row.chance === null ? '' : chanceShort(row.chance)}</span
				>
				<span class="n adp">{adpFigure(row.adp)}</span>
				<span
					class="n adp gapc"
					class:gain={gapTone(row.gap) === 'gain'}
					class:loss={gapTone(row.gap) === 'loss'}>{gapText(row.gap)}</span
				>
				<span class="go"
					>{#if i === 0}{@render verb()}{/if}</span
				>
			</div>
		{/each}
		<div class="below">{@render verb()}</div>
	</div>
</Panel>

<style>
	/* The pool's grid (Pool.svelte --pool-cols): face, player, over replacement, the chance, ADP, the
	   actions. At your last pick the chance track stays, empty, as the pool keeps its column, so every
	   figure still sits over the pool's column for it. */
	.call {
		--call-cols: 40px minmax(0, 1fr) 118px 136px 118px var(--gap-track,) 150px;
		padding: var(--s-3) 0 0;
	}

	/* The Gap sits over the pool's Gap column, drawn only where the room's pool carries one (the
	   track and the cell come from RoomLayout's --gap-track and --gap-display). */
	.gapc {
		display: var(--gap-display, none);
	}

	.gain {
		color: var(--gain-ink);
	}

	.loss {
		color: var(--loss-ink);
	}

	.tag {
		display: block;
		padding: 0 var(--s-3) var(--s-2);
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--accent-text);
	}

	.waiting .tag {
		color: var(--ink-3);
	}

	.grid {
		display: grid;
		grid-template-columns: var(--call-cols);
		column-gap: var(--s-3);
		align-items: center;
		padding: 4px var(--s-3);
		font-variant-numeric: tabular-nums;
	}

	.head {
		padding-bottom: var(--s-2);
		border-bottom: 1px solid var(--line-strong);
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.row {
		min-height: var(--row-h);
		border-bottom: 1px solid var(--line);
	}

	.row:last-of-type {
		border-bottom: 0;
	}

	.n {
		text-align: right;
		white-space: nowrap;
	}

	.row .n {
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-lg);
		color: var(--ink-2);
	}

	.row .n.muted {
		font-family: var(--font-ui);
		font-weight: 500;
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.face {
		display: flex;
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
	.pick {
		min-height: 64px;
		background: var(--accent-wash);
	}

	.waiting .pick {
		background: var(--surface-2);
	}

	.pick .nm b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-head);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	.pick .n {
		font-size: var(--t-xl);
		color: var(--ink);
	}

	.go {
		display: flex;
	}

	.below {
		display: none;
		padding: var(--s-3);
	}

	/* The skeleton: the last call's frame, every word a quiet block of the same size. */
	.reading :is(.row .n, .nm b, .nm small) {
		color: transparent;
	}

	.reading .face {
		opacity: 0;
	}

	/* The pool's narrower grid: its actions shrink to a key's width, so the verb moves under the rows. */
	@media (max-width: 1180px) {
		.call {
			--call-cols: 40px minmax(0, 1fr) 108px 126px 108px var(--gap-track,);
		}

		.go {
			display: none;
		}

		.below {
			display: block;
		}
	}

	/* In a hand: the pool's phone grid, over replacement and the chance; ADP is the pool's desk column. */
	@media (max-width: 760px) {
		.call {
			--call-cols: 36px minmax(0, 1fr) 84px 84px;
		}

		.grid {
			column-gap: var(--s-2);
		}

		.adp {
			display: none;
		}

		.head {
			font-size: 10px;
			letter-spacing: 0.02em;
		}

		.row .n {
			font-size: var(--t-md);
		}

		.pick .nm b {
			font-size: var(--t-lg);
			white-space: normal;
		}

		.pick .n {
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
	}
</style>

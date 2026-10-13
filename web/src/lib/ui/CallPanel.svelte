<script lang="ts">
	import type { Snippet } from 'svelte';
	import { oddsShort } from '#lib/format/draft.ts';
	import { signed } from '#lib/format/number.ts';
	import type { PlayerRef } from '#lib/types/player.ts';
	import type { CallAction } from '#lib/types/room.ts';
	import Face from './Face.svelte';
	import Panel from './Panel.svelte';
	import PositionPill from './PositionPill.svelte';
	import Quiet from './Quiet.svelte';
	import Verb from './Verb.svelte';

	interface Props {
		/** Where the call stands: "Our call at 5.08". */
		tag: string;
		player: PlayerRef;
		/** His points over replacement. */
		vor: number;
		/** Where drafters take him, in words: "drafters take him 1 earlier". */
		adp: string;
		/** His chance of lasting to your next pick, the one big number. */
		odds: number;
		/** What the odds are of: "chance he is still there at 6.05". */
		oddsLabel: string;
		/** The runner-up in a sentence, with his name in bold. */
		reason: Snippet;
		action: CallAction;
		/** Off your turn the call waits on the board: a quiet edge, and the action is quiet too. */
		waiting?: boolean;
	}

	let { tag, player, vor, adp, odds, oddsLabel, reason, action, waiting = false }: Props = $props();
</script>

<Panel as="section" label={tag} padding="none" edge={waiting ? 'quiet' : 'accent'}>
	<div class="call" class:waiting>
		<Face src={player.headshot} name={player.name} size={72} loading="eager" />
		<div class="what">
			<span class="tag">{tag}</span>
			<h2>Take {player.name}</h2>
			<div class="meta">
				<PositionPill position={player.position} rank={player.positionRank} />
				{player.team} · {signed(vor)} over replacement · {adp}
			</div>
			<p>{@render reason()}</p>
		</div>
		<div class="odds">
			<b>{oddsShort(odds)}</b>
			<span>{oddsLabel}</span>
			<div class="act">
				{#if waiting}
					<Quiet size="lg" fill key={action.key} onclick={action.onclick}>{action.label}</Quiet>
				{:else}
					<Verb size="lg" fill key={action.key} onclick={action.onclick}>{action.label}</Verb>
				{/if}
			</div>
		</div>
	</div>
</Panel>

<style>
	.call {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--s-4);
		align-items: center;
		padding: var(--s-4);
	}

	.tag {
		display: block;
		font-size: var(--t-xs);
		font-weight: 700;
		letter-spacing: var(--track-label);
		text-transform: uppercase;
		color: var(--accent-text);
		margin-bottom: 4px;
	}

	.waiting .tag {
		color: var(--ink-3);
	}

	h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 38px;
		line-height: 0.95;
		text-transform: uppercase;
		text-wrap: balance;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		font-size: var(--t-sm);
		color: var(--ink-2);
		margin: 6px 0 8px;
	}

	p {
		margin: 0;
		font-size: var(--t-md);
		color: var(--ink-2);
		max-width: 60ch;
	}

	p :global(b) {
		color: var(--ink);
		font-weight: 600;
	}

	.odds {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--s-2);
		text-align: right;
	}

	.odds b {
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 72px;
		line-height: 0.8;
		font-variant-numeric: tabular-nums;
	}

	.odds span {
		font-size: var(--t-sm);
		color: var(--ink-2);
		max-width: 22ch;
	}

	@media (max-width: 760px) {
		.call {
			grid-template-columns: auto minmax(0, 1fr);
			row-gap: var(--s-3);
			padding: var(--s-3);
		}

		h2 {
			font-size: 28px;
		}

		.odds {
			grid-column: 1 / -1;
			flex-direction: row;
			flex-wrap: wrap;
			align-items: flex-end;
			justify-content: flex-start;
			gap: var(--s-3);
			text-align: left;
		}

		.odds b {
			font-size: 56px;
		}

		.odds span {
			flex: 1;
			min-width: 0;
		}

		.act {
			flex-basis: 100%;
		}
	}
</style>

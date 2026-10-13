<script lang="ts">
	import { DEFAULT_TEAMS, lastName, pickLabel } from '#lib/format/draft.ts';
	import type { WentPick } from '#lib/types/room.ts';
	import Face from './Face.svelte';
	import Panel from './Panel.svelte';

	interface Props {
		/** Your last pick, the overall number. */
		since: number;
		/** Every pick after yours up to now, oldest first. */
		went: readonly WentPick[];
		teams?: number;
	}

	let { since, went, teams = DEFAULT_TEAMS }: Props = $props();

	const fromQueue = $derived(went.filter((pick) => pick.queued).length);
</script>

<Panel padding="none">
	<div class="since">
		<div class="lead">
			<b>{went.length}</b>
			<span>went since your pick at {pickLabel(since, teams)}</span>
			<span>{fromQueue === 0 ? 'none' : fromQueue} from your queue</span>
		</div>
		<ol class="run">
			{#each went as { player, pick, queued } (pick)}
				<li class:queued>
					<Face src={player.headshot} size={36} ringed={queued} />
					<b>{lastName(player.name)}</b>
					<span>{pickLabel(pick, teams)}{queued ? ' · queued' : ''}</span>
				</li>
			{/each}
		</ol>
	</div>
</Panel>

<style>
	.since {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-3) var(--s-4);
		overflow-x: auto;
	}

	.lead {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-right: var(--s-3);
		border-right: 1px solid var(--line);
	}

	.lead b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		font-size: 26px;
		line-height: 1;
	}

	.lead span {
		font-size: var(--t-xs);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.run {
		display: flex;
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		width: 58px;
		font-size: var(--t-xs);
		color: var(--ink-3);
		text-align: center;
	}

	li b {
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		max-width: 58px;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: var(--t-xs);
	}

	.queued span {
		color: var(--accent-text);
		font-weight: 600;
	}

	@media (max-width: 760px) {
		.since {
			padding: var(--s-3);
		}
	}
</style>

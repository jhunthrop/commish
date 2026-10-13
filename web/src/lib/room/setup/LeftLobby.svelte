<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { type LobbyRoom, rooms } from '../api.ts';
	import { lobbyTitle } from './setup.ts';

	interface Props {
		/** The lobby the drafter left. */
		id: string;
		/** How often the lobby is read again, so Read the report appears when the draft ends. */
		pollMs: number;
		/** There is nothing more to offer: the seat is gone, or its report was opened. */
		ondone: () => void;
	}

	let { id, pollMs, ondone }: Props = $props();

	let room = $state<LobbyRoom | null>(null);

	async function load(): Promise<void> {
		try {
			room = await rooms.lobby(id);
			if (room.status === 'abandoned') ondone();
		} catch {
			// A seat freed before the draft started is not ours to return to.
			room = null;
			ondone();
		}
	}

	onMount(() => {
		void load();
		const poll = setInterval(() => {
			if (room?.status !== 'complete') void load();
		}, pollMs);
		return () => clearInterval(poll);
	});
</script>

{#if room && room.status !== 'abandoned'}
	{@const title = lobbyTitle(
		room.teams,
		room.settings.scoring.preset ?? 'ppr',
		room.settings.lineup
	)}
	<Panel edge="quiet">
		<h3>You left a lobby</h3>
		<p>
			{title}.
			{room.status === 'complete'
				? 'The draft is over and your report is ready.'
				: 'Your queue drafts your seat, then the board. Return and the seat is yours again.'}
		</p>
		<div class="acts">
			{#if room.status === 'complete'}
				<Quiet href={resolve('/lobby/[id]/report', { id })} onclick={ondone}>Read the report</Quiet>
			{:else}
				<Quiet href={resolve('/lobby/[id]', { id })}>Return to the lobby</Quiet>
			{/if}
		</div>
	</Panel>
{/if}

<style>
	h3 {
		margin: 0 0 var(--s-1);
		font-size: var(--t-md);
	}

	p {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.acts {
		margin-top: var(--s-3);
	}
</style>

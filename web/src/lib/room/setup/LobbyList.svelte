<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { LobbyFilling, LobbyFormat } from '../api.ts';
	import { lobbyTitle } from './setup.ts';

	interface Props {
		lobbies: readonly LobbyFilling[];
		busy: boolean;
		onjoin: (format: LobbyFormat) => void;
	}

	let { lobbies, busy, onjoin }: Props = $props();
</script>

<Panel>
	<h3>Lobbies filling now</h3>
	<p>
		A lobby starts when it is full, or 90 seconds after the first drafter joins, with bots in the
		open seats.
	</p>
	<ul>
		{#each lobbies as lobby (lobby.format)}
			<li>
				<div>
					<b>{lobbyTitle(lobby.teams, lobby.scoring, lobby.lineup)}</b>
					<span>{lobby.clock_seconds} seconds a pick</span>
				</div>
				<span class="fill">{lobby.filling} of {lobby.teams}</span>
				<Quiet size="sm" disabled={busy} onclick={() => onjoin(lobby.format)}>Join</Quiet>
			</li>
		{/each}
	</ul>
</Panel>

<style>
	h3 {
		margin: 0 0 var(--s-1);
		font-size: var(--t-md);
	}

	p {
		margin: 0 0 var(--s-3);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		gap: var(--s-2);
		align-items: center;
		padding: var(--s-2) var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		font-size: var(--t-sm);
	}

	li b {
		display: block;
	}

	li span {
		color: var(--ink-3);
		font-size: var(--t-xs);
	}

	.fill {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: var(--t-lg);
		color: var(--ink-2);
	}
</style>

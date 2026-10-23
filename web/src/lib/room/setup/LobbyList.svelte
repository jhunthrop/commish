<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { LobbyFilling, LobbyFormat } from '../api.ts';
	import { lobbyFillWords, lobbyListHead, lobbyTitle } from './setup.ts';

	interface Props {
		lobbies: readonly LobbyFilling[];
		busy: boolean;
		/** Joining needs a handle, so a signed-out reader sees the lobbies and the way to sign in. */
		signInHref: string | null;
		onjoin: (format: LobbyFormat) => void;
	}

	let { lobbies, busy, signInHref, onjoin }: Props = $props();

	const joinable = $derived(signInHref === null && !busy);
</script>

<Panel>
	<h3>{lobbyListHead(lobbies)}</h3>
	<ul>
		{#each lobbies as lobby (lobby.format)}
			{#snippet body()}
				{@const fill = lobbyFillWords(lobby.filling)}
				<span class="what">
					<b>{lobbyTitle(lobby.teams, lobby.scoring, lobby.lineup)}</b>
					<span>{lobby.clock_seconds} s a pick</span>
				</span>
				<span class="fill" class:none={fill.empty}>{fill.words}</span>
			{/snippet}
			<li>
				{#if joinable}
					<button type="button" class="card" onclick={() => onjoin(lobby.format)}>
						{@render body()}<span class="join">Join</span>
					</button>
				{:else}
					<div class="card">{@render body()}</div>
				{/if}
			</li>
		{/each}
	</ul>
	{#if signInHref}
		<div class="sign">
			<Quiet size="sm" href={signInHref}>Sign in to join a lobby</Quiet>
		</div>
	{/if}
</Panel>

<style>
	h3 {
		margin: 0 0 var(--s-3);
		font-size: var(--t-md);
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: var(--s-2);
		align-items: center;
		width: 100%;
		min-height: var(--touch);
		padding: var(--s-2) var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		font-size: var(--t-sm);
		text-align: left;
	}

	button.card {
		cursor: pointer;
	}

	button.card:hover {
		border-color: var(--line-strong);
		background: var(--surface-2);
	}

	button.card:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}

	.what b {
		display: block;
	}

	.what span {
		color: var(--ink-3);
		font-size: var(--t-xs);
	}

	.fill {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 700;
		font-size: var(--t-lg);
		color: var(--ink-2);
		text-align: right;
		white-space: nowrap;
	}

	/* No one in yet: words, not a figure, quiet beside the card's Join. */
	.fill.none {
		font-family: var(--font-ui);
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-3);
	}

	.join {
		font-weight: 600;
		color: var(--accent-text);
	}

	.sign {
		margin-top: var(--s-3);
	}
</style>

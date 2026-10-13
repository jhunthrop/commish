<script lang="ts">
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { LobbyFilling, LobbyFormat } from '../api.ts';
	import { LOBBY_FILL_SECONDS, lobbyTitle } from './setup.ts';

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
	<h3>Lobbies filling now</h3>
	<p>
		A lobby starts when it is full, or {LOBBY_FILL_SECONDS} seconds after the first drafter joins, with
		bots in the open seats.
	</p>
	<ul>
		{#each lobbies as lobby (lobby.format)}
			{@const empty = lobby.filling === 0}
			{#snippet body()}
				<span class="what">
					<b>{lobbyTitle(lobby.teams, lobby.scoring, lobby.lineup)}</b>
					<span
						>{empty
							? `Nobody here yet. Be the first, it starts ${LOBBY_FILL_SECONDS} seconds after you join.`
							: `${lobby.clock_seconds} seconds a pick`}</span
					>
				</span>
				{#if !empty}<span class="fill">{lobby.filling} of {lobby.teams}</span>{/if}
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
	}

	.join {
		font-weight: 600;
		color: var(--accent-text);
	}

	.sign {
		margin-top: var(--s-3);
	}
</style>

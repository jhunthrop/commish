<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { links } from '#lib/site/links.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { railLeague } from '#lib/ui/rail-league.svelte.ts';
	import { ApiError, leagueApi, type AttachedLeague } from './api.ts';
	import { hostWords } from './model.ts';

	/** The account's leagues on other hosts, each with a quiet way to stop following it. It reads
	 * its own list, so the account page's other reads never wait on it. */
	let leagues = $state<AttachedLeague[] | null>(null);
	let failed = $state(false);
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);

	onMount(() => {
		leagueApi
			.attached()
			.then((list) => {
				leagues = list;
				railLeague.note(list[0]?.id ?? null);
			})
			.catch(() => (failed = true));
	});

	async function detach(league: AttachedLeague): Promise<void> {
		busy = league.id;
		problem = null;
		try {
			await leagueApi.detach(league.id);
			const rest = (leagues ?? []).filter((l) => l.id !== league.id);
			leagues = rest;
			railLeague.note(rest[0]?.id ?? null);
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = null;
		}
	}

	function name(league: AttachedLeague): string {
		return league.name !== '' ? league.name : `Your ${hostWords(league.host)} league`;
	}
</script>

<section aria-label="Your leagues">
	<PanelHead title="Your leagues" aside={leagues ? String(leagues.length) : undefined} level={2} />
	{#if failed}
		<p class="note">Your leagues can't be read right now.</p>
	{:else if leagues && leagues.length > 0}
		<ul class="list">
			{#each leagues as league (league.id)}
				<li>
					<span class="what">
						<a href={resolve('/league/[id]', { id: league.id })}><b>{name(league)}</b></a>
						<span class="text">
							{league.team_name !== '' ? `as ${league.team_name}, ` : ''}on {hostWords(league.host)}
						</span>
					</span>
					<Quiet size="sm" disabled={busy !== null} onclick={() => void detach(league)}
						>{busy === league.id ? 'Detaching' : 'Detach'}</Quiet
					>
				</li>
			{/each}
		</ul>
		{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
	{:else if leagues}
		<EmptyState level={3} title="No leagues yet">
			{#snippet actions()}<Quiet href={links.leagueNew()}>Follow your league</Quiet>{/snippet}
		</EmptyState>
	{/if}
</section>

<style>
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
		padding: var(--s-2) 0;
		border-bottom: 1px solid var(--line);
	}

	.what {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	a {
		color: var(--ink);
		text-decoration: none;
		unicode-bidi: isolate;
	}

	a:hover b {
		text-decoration: underline;
	}

	.text,
	.note {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
		unicode-bidi: isolate;
	}

	.problem {
		margin: var(--s-2) 0 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}
</style>

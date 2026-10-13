<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { links } from '#lib/site/links.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { railLeague } from '#lib/account/rail-league.svelte.ts';
	import { ApiError, leagueApi, type AttachedLeague } from './api.ts';
	import { hostWords } from './model.ts';

	/** The account's leagues on other hosts, each with a quiet way to stop following it and, for a
	 * few seconds after, to take that back. It reads its own list, so the account page's other reads
	 * never wait on it. A detached league keeps its saved settings either way. */
	let leagues = $state<AttachedLeague[] | null>(null);
	let failed = $state(false);
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);
	/** Leagues detached a moment ago, still on the list with their undo. */
	let detached = $state<ReadonlySet<string>>(new Set());

	/** How long a detached league stays on the list with its undo. */
	const UNDO_MS = 10_000;

	onMount(() => {
		leagueApi
			.attached()
			.then((list) => {
				leagues = list;
			})
			.catch(() => (failed = true));
	});

	function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
		return new Set([...set].filter((x) => x !== id));
	}

	async function act(id: string, step: () => Promise<void>): Promise<void> {
		busy = id;
		problem = null;
		try {
			await step();
		} catch (error) {
			problem = error instanceof ApiError ? error.message : 'That did not go through. Try again.';
		} finally {
			busy = null;
		}
	}

	function detach(league: AttachedLeague): Promise<void> {
		return act(league.id, async () => {
			await leagueApi.detach(league.id);
			detached = new Set([...detached, league.id]);
			void railLeague.refresh();
			setTimeout(() => {
				if (!detached.has(league.id)) return;
				detached = without(detached, league.id);
				leagues = (leagues ?? []).filter((l) => l.id !== league.id);
			}, UNDO_MS);
		});
	}

	function undo(league: AttachedLeague): Promise<void> {
		return act(league.id, async () => {
			await leagueApi.restore(league.id);
			detached = without(detached, league.id);
			void railLeague.refresh();
		});
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
					{#if detached.has(league.id)}
						<span class="undo" role="status">
							<span class="text">Detached.</span>
							<Quiet size="sm" disabled={busy !== null} onclick={() => void undo(league)}
								>Undo</Quiet
							>
						</span>
					{:else}
						<Quiet size="sm" disabled={busy !== null} onclick={() => void detach(league)}
							>{busy === league.id ? 'Detaching' : 'Detach'}</Quiet
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
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

	.undo {
		display: flex;
		align-items: center;
		gap: var(--s-2);
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import { hasFeature, type Feature } from '#lib/account/features.ts';
	import { resolve } from '$app/paths';
	import { LEAGUES_ANCHOR, links } from '#lib/site/links.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import ActionRow from '#lib/ui/ActionRow.svelte';
	import ActionRows from '#lib/ui/ActionRows.svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { ApiError, leagueApi, type AttachedLeague } from './api.ts';
	import { followedCount, followingWords } from './follow-many.ts';
	import { followedLine, followedName } from './model.ts';
	import OneLeagueFree from './OneLeagueFree.svelte';

	interface Props {
		/** What the account may use (/me, Can): many_leagues follows more than one league. */
		features: readonly Feature[];
	}

	let { features }: Props = $props();

	/** The account's leagues on other hosts, each with a quiet way to stop following it and, for a
	 * few seconds after, to take that back. It reads its own list, so the account page's other reads
	 * never wait on it. A detached league keeps its saved settings either way. */
	let leagues = $state<AttachedLeague[] | null>(null);
	let failed = $state(false);
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);
	/** Leagues detached a moment ago, still on the list with their undo. */
	let detached = $state<ReadonlySet<string>>(new Set());

	/** How many leagues were just followed, when the attach page sent the reader here to see them. */
	let followed = $state<number | null>(null);
	const many = $derived(hasFeature(features, 'many_leagues'));
	/** The leagues still followed, the ones detached a moment ago left out. */
	const live = $derived((leagues ?? []).filter((l) => !detached.has(l.id)).length);

	/** How long a detached league stays on the list with its undo. */
	const UNDO_MS = 10_000;

	onMount(() => {
		// Read in the browser only: the account page's shell is prerendered.
		followed = followedCount(new URL(window.location.href).searchParams);
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
			void siteContext.refresh();
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
			void siteContext.refresh();
		});
	}
</script>

<section id={LEAGUES_ANCHOR} aria-label="Your leagues">
	<PanelHead title="Your leagues" aside={leagues ? String(leagues.length) : undefined} level={2} />
	{#if failed}
		<p class="note">Your leagues can't be read right now.</p>
	{:else if leagues && leagues.length > 0}
		{#if followed !== null}<p class="note" role="status">{followingWords(followed)}</p>{/if}
		<ActionRows label="Your leagues">
			{#each leagues as league (league.id)}
				<ActionRow
					lead={followedName(league)}
					href={resolve('/league/[id]', { id: league.id })}
					text={followedLine(league)}
				>
					{#snippet action()}
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
					{/snippet}
				</ActionRow>
			{/each}
		</ActionRows>
		{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		{#if many}
			<Quiet size="sm" href={links.leagueNew()}>Follow another league</Quiet>
		{:else if live > 0}
			<OneLeagueFree />
		{/if}
	{:else if leagues}
		<EmptyState level={3} title="No leagues yet">
			{#snippet actions()}<Quiet href={links.leagueNew()}>Follow your league</Quiet>{/snippet}
		</EmptyState>
	{/if}
</section>

<style>
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

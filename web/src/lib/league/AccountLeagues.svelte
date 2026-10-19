<script lang="ts">
	import { onMount } from 'svelte';
	import { hasFeature, type Feature } from '#lib/account/features.ts';
	import { resolve } from '$app/paths';
	import { LEAGUES_ANCHOR, links } from '#lib/site/links.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { ApiError, leagueApi, type AttachedLeague } from './api.ts';
	import { followedCount, followingWords } from './follow-many.ts';
	import { followedName } from './model.ts';
	import { ATTACHED_WORDS, attachedRow } from './attached-rows.ts';
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
	/** The list's clock: the instant it was read, set with the list, so each last read is said against
	 * it. No row draws before the list lands. */
	let now = $state(new Date(0));
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
				now = new Date();
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

<section id={LEAGUES_ANCHOR} aria-label={ATTACHED_WORDS.title}>
	<div class="sec-h">
		<h2>{ATTACHED_WORDS.title}</h2>
		{#if leagues}<span>{leagues.length}, newest first</span>{/if}
	</div>
	{#if failed}
		<p class="text">Your leagues can't be read right now.</p>
	{:else if leagues && leagues.length > 0}
		{#if followed !== null}<p class="text" role="status">{followingWords(followed)}</p>{/if}
		<table class="set">
			<colgroup>
				<col />
				<col class="c-rec" />
				<col class="c-season" />
				<col class="c-read" />
				<col class="c-act" />
			</colgroup>
			<thead>
				<tr>
					<th scope="col">{ATTACHED_WORDS.league}</th>
					<th scope="col">{ATTACHED_WORDS.record}</th>
					<th scope="col">{ATTACHED_WORDS.season}</th>
					<th scope="col">{ATTACHED_WORDS.lastRead}</th>
					<th scope="col"><span class="sr">Verb</span></th>
				</tr>
			</thead>
			<tbody>
				{#each leagues as league (league.id)}
					{@const row = attachedRow(league, now)}
					<tr>
						<th scope="row">
							<a class="st open" href={resolve('/league/[id]', { id: league.id })}
								><b>{followedName(league)}</b><span>{row.team}</span></a
							>
						</th>
						<td><span class="st"><b class="num">{row.record}</b><span>{row.place}</span></span></td>
						<td class="ph-hide">{row.season}</td>
						<td class="read"><span class="ph-only">Last read&nbsp;</span>{row.read}</td>
						<td class="act">
							{#if detached.has(league.id)}
								<span class="undo" role="status">
									<span class="text">Detached.</span>
									<Quiet size="sm" disabled={busy !== null} onclick={() => void undo(league)}
										>Undo</Quiet
									>
								</span>
							{:else}
								<Quiet size="sm" href={resolve('/league/[id]', { id: league.id })}>Open</Quiet>
								<Quiet size="sm" disabled={busy !== null} onclick={() => void detach(league)}
									>{busy === league.id ? 'Detaching' : 'Detach'}</Quiet
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if problem}<ProblemLine>{problem}</ProblemLine>{/if}
		<div class="tfoot">
			{#if many}
				<Quiet size="sm" href={links.leagueNew()}>Follow another league</Quiet>
			{:else if live > 0}
				<OneLeagueFree />
			{/if}
		</div>
	{:else if leagues}
		<EmptyState level={3} title="No leagues yet">
			{#snippet actions()}<Quiet href={links.leagueNew()}>Follow your league</Quiet>{/snippet}
		</EmptyState>
	{/if}
</section>

<style>
	.text {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
		unicode-bidi: isolate;
	}

	.c-rec {
		width: 110px;
	}

	.c-season {
		width: 220px;
	}

	.c-read {
		width: 120px;
	}

	.c-act {
		width: 190px;
	}

	.act {
		white-space: nowrap;
	}

	.act :global(a) {
		margin-right: var(--s-2);
	}

	.open {
		color: var(--ink);
		text-decoration: none;
	}

	.open:hover b {
		text-decoration: underline;
	}

	.tfoot {
		margin-top: var(--s-2);
	}

	.undo {
		display: flex;
		align-items: center;
		gap: var(--s-2);
	}
</style>

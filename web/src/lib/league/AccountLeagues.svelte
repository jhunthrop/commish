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
	import type { AttachedList } from './attached-list.svelte.ts';
	import { followedCount, followingWords } from './follow-many.ts';
	import { followedName } from './model.ts';
	import { ATTACHED_WORDS, attachedCount, attachedRow } from './attached-rows.ts';
	import { ACCOUNT_WORDS } from '#lib/account/words.ts';
	import { FOLLOW_ANOTHER, FOLLOW_FIRST } from '#lib/context/menu-words.ts';

	interface Props {
		/** What the account may use (/me, Can): many_leagues follows more than one league. */
		features: readonly Feature[];
		/** The account's leagues, read once by the Account room for this table and the Platforms
		 * table both (Lane 94 fix round 2). */
		list: AttachedList;
	}

	let { features, list }: Props = $props();

	/** The account's leagues on other hosts, each with a quiet way to stop following it and, for a
	 * few seconds after, to take that back. A detached league keeps its saved settings either way.
	 * No row draws before the list lands; each last read is said against the list's own clock. */
	const leagues = $derived(list.leagues);
	const now = $derived(new Date(list.readAt));
	const failed = $derived(list.failed);
	const detached = $derived(new Set(list.detached));
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);

	/** How many leagues were just followed, when the attach page sent the reader here to see them. */
	let followed = $state<number | null>(null);
	const many = $derived(hasFeature(features, 'many_leagues'));

	/** How long a detached league stays on the list with its undo. */
	const UNDO_MS = 10_000;

	onMount(() => {
		// Read in the browser only: the account page's shell is prerendered.
		followed = followedCount(new URL(window.location.href).searchParams);
	});

	async function act(id: string, step: () => Promise<void>): Promise<void> {
		busy = id;
		problem = null;
		try {
			await step();
		} catch (error) {
			problem = error instanceof ApiError ? error.message : ACCOUNT_WORDS.failed;
		} finally {
			busy = null;
		}
	}

	function detach(league: AttachedLeague): Promise<void> {
		return act(league.id, async () => {
			await leagueApi.detach(league.id);
			list.markDetached(league.id);
			void siteContext.refresh();
			setTimeout(() => list.drop(league.id), UNDO_MS);
		});
	}

	function undo(league: AttachedLeague): Promise<void> {
		return act(league.id, async () => {
			await leagueApi.restore(league.id);
			list.unmarkDetached(league.id);
			void siteContext.refresh();
		});
	}
</script>

<section id={LEAGUES_ANCHOR} aria-label={ATTACHED_WORDS.title}>
	<div class="sec-h">
		<h2>{ATTACHED_WORDS.title}</h2>
		{#if leagues}<span>{attachedCount(leagues.length)}</span>{/if}
	</div>
	{#if failed}
		<p class="text">{ATTACHED_WORDS.unread}</p>
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
								><b class="name" title={followedName(league)}>{followedName(league)}</b><span
									>{row.team}</span
								></a
							>
						</th>
						<td><span class="st"><b class="num">{row.record}</b><span>{row.place}</span></span></td>
						<td class="ph-hide">{row.season}</td>
						<td class="read"
							><span class="ph-only">{ATTACHED_WORDS.lastRead}&nbsp;</span>{row.read}</td
						>
						<td class="act">
							{#if detached.has(league.id)}
								<span class="undo" role="status">
									<span class="text">{ATTACHED_WORDS.detached}</span>
									<Quiet size="sm" disabled={busy !== null} onclick={() => void undo(league)}
										>{ATTACHED_WORDS.undo}</Quiet
									>
								</span>
							{:else}
								<Quiet size="sm" href={resolve('/league/[id]', { id: league.id })}
									>{ATTACHED_WORDS.open}</Quiet
								>
								<Quiet size="sm" disabled={busy !== null} onclick={() => void detach(league)}
									>{busy === league.id ? ATTACHED_WORDS.detaching : ATTACHED_WORDS.detach}</Quiet
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
				<Quiet size="sm" href={links.leagueNew()}>{FOLLOW_ANOTHER}</Quiet>
			{/if}
		</div>
	{:else if leagues}
		<EmptyState level={3} title={ATTACHED_WORDS.none}>
			{#snippet actions()}<Quiet href={links.leagueNew()}>{FOLLOW_FIRST}</Quiet>{/snippet}
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

	/* A league's name keeps at most two lines at a desk, the whole name on its title (Lane 117, B84). */
	@media (min-width: 901px) {
		.name {
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			overflow: hidden;
		}
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

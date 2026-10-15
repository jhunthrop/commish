<script lang="ts" generics="T extends AdviceHead">
	import { onMount, type Snippet } from 'svelte';
	import { ApiError } from '#lib/api/client.ts';
	import { HTTP_STATUS, hasStatus, isSignedOut } from '#lib/api/status.ts';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { links } from '#lib/site/links.ts';
	import { leagueApi, type LeagueHost } from '../api.ts';
	import { loadBoard, type LeagueBoard } from '../board.ts';
	import { followSwitch } from '../follow-switch.svelte.ts';
	import { POLL_MS, followedName, readAgoLine, standingWords } from '../model.ts';
	import LeagueTabs from './LeagueTabs.svelte';
	import { tabHref } from './tabs.ts';
	import type { AdviceHead } from './api.ts';
	import { refreshedWords, type InSeasonScreen } from './words.ts';

	/** One in-season screen of a followed league: the league's title with its read and order stamps,
	 * the league's tabs, and the screen's answer once read (reserved rows until then, the API's own
	 * sentence when it has no answer). Read on open and once a minute while open, as the league page
	 * is. Opening it selects its league in the shell's switch; switching there opens this screen of
	 * the league switched to. */
	interface Props {
		id: string;
		screen: InSeasonScreen;
		/** The page's title in the browser's tab. */
		title: string;
		/** Reads the screen's answer. */
		read: () => Promise<T>;
		/** How many rows to hold while the answer is read, so nothing moves when it lands. */
		reserve: number;
		/** The screen, from its answer, the board and the league's host. */
		children: Snippet<[T, LeagueBoard, LeagueHost]>;
	}

	let { id, screen, title, read, reserve, children }: Props = $props();

	let advice = $state<T | null>(null);
	let board = $state<LeagueBoard | null>(null);
	let failure = $state<'signed-out' | 'missing' | null>(null);
	/** The API's sentence when it has no answer for this league (not in season, no saved scoring). */
	let refusal = $state<string | null>(null);
	/** A later read failed: the page keeps the last answer and says so. */
	let problem = $state<string | null>(null);
	let now = $state(new Date());

	// The page is created per league ({#key} in the route), so its id is fixed for its life.
	// svelte-ignore state_referenced_locally
	followSwitch(id, (league) => tabHref(screen, league));

	const league = $derived(siteContext.leagues.find((l) => l.id === id) ?? null);

	async function load(): Promise<void> {
		try {
			advice = await read();
			now = new Date();
			problem = null;
			refusal = null;
		} catch (error) {
			if (isSignedOut(error)) failure = 'signed-out';
			else if (hasStatus(error, HTTP_STATUS.notFound)) failure = 'missing';
			else if (advice !== null)
				problem = 'Your league could not be read just now. The page shows the last read.';
			else
				refusal =
					error instanceof ApiError ? error.message : 'Your league could not be read just now.';
		}
	}

	onMount(() => {
		void siteContext
			.load()
			.then(() => loadBoard(league?.format ?? 'ppr', {}).then((loaded) => (board = loaded)));
		void load();
		const timer = setInterval(() => void load(), POLL_MS);
		return () => clearInterval(timer);
	});

	const name = $derived(league ? followedName(league) : 'Your league');
	const standing = $derived(
		league?.standing ? `${league.team_name}, ${standingWords(league)}.` : ''
	);
</script>

<svelte:head>
	<title>{title} · {name} · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title="League" active="league">
	{#if failure === 'signed-out'}
		<div class="pad">
			<EmptyState
				title="Sign in to see your league"
				line="A league lives on your account. Following one is free."
			>
				{#snippet actions()}<Verb href={leagueApi.signInUrl(tabHref(screen, id))}>Sign in</Verb
					>{/snippet}
			</EmptyState>
		</div>
	{:else if failure === 'missing'}
		<div class="pad">
			<EmptyState
				title="This league is not on your account"
				line="Paste its link again to follow it."
			>
				{#snippet actions()}<Verb href={links.leagueNew()}>Follow a league</Verb>{/snippet}
			</EmptyState>
		</div>
	{:else}
		<main class="league">
			<header class="lead">
				<DisplayTitle size="page">{name}</DisplayTitle>
				<p class="sub">
					{standing}
					{#if advice}
						<span class="read" role="status"
							>{league ? readAgoLine(league.host, advice.read_at, now) : ''}
							{refreshedWords(advice.order_basis, advice.refreshed)}</span
						>
					{/if}
				</p>
			</header>
			<LeagueTabs {id} current={screen} />
			{#if refusal}
				<Panel edge="loss" padding="sm"><ProblemLine>{refusal}</ProblemLine></Panel>
			{:else if advice && board && league}
				{#if problem}
					<Panel edge="loss" padding="sm"><ProblemLine>{problem}</ProblemLine></Panel>
				{/if}
				{@render children(advice, board, league.host)}
			{:else}
				<div class="reserve" aria-busy="true" aria-label="Reading your league">
					<div class="call"></div>
					{#each { length: reserve }, i (i)}<div class="row"></div>{/each}
				</div>
			{/if}
		</main>
	{/if}
</Shell>

<style>
	.pad {
		padding: var(--s-4) var(--s-5) 0;
	}

	.league {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-4) var(--s-5) var(--s-6);
	}

	.lead {
		min-width: 0;
	}

	.sub {
		margin: var(--s-1) 0 0;
		color: var(--ink-2);
	}

	.read {
		color: var(--ink-3);
		font-size: var(--t-sm);
	}

	/* The rows to come, at their own height, so the answer lands without moving the page. */
	.reserve {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
	}

	.reserve .call {
		height: 74px;
		border-radius: var(--r-md);
		background: var(--surface);
	}

	.reserve .row {
		height: calc(var(--row-h) + 1px);
		margin-top: calc(-1 * var(--s-4));
		border-bottom: 1px solid var(--line);
		background: var(--surface);
	}

	@media (max-width: 760px) {
		.league {
			padding: var(--s-3) var(--s-4) var(--s-5);
		}

		.pad {
			padding: var(--s-4) var(--s-4) 0;
		}
	}
</style>

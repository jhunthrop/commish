<script lang="ts" generics="T extends AdviceHead">
	import { onMount, type Snippet } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { links } from '#lib/site/links.ts';
	import { leagueApi, type AttachedLeague, type LeagueHost } from '../api.ts';
	import { followSwitch } from '../follow-switch.svelte.ts';
	import { POLL_MS, followedName, readAgoLine, standingWords } from '../model.ts';
	import LeagueTabs from './LeagueTabs.svelte';
	import { tabHref } from './tabs.ts';
	import type { AdviceHead } from './api.ts';
	import { readFailure, screenView, type ReadState } from './state.ts';
	import { LINES, TAB_LABELS, refreshedWords, signInTitle, type InSeasonScreen } from './words.ts';

	/** One in-season screen of a followed league: the league's title with its read and order stamps,
	 * the league's tabs, and the screen's answer once read (reserved rows until then, the API's own
	 * sentence when it has no answer, a sentence when the account's leagues cannot be read). Read on
	 * open and once a minute while open, as the league page is; a failed read of the account's
	 * leagues is tried again with it. The answer carries every face and page, so no board is read. Opening it selects its league in the shell's
	 * switch; switching there opens this screen of the league switched to. */
	interface Props {
		id: string;
		screen: InSeasonScreen;
		/** The page's title in the browser's tab. */
		title: string;
		/** Reads the screen's answer. */
		read: () => Promise<T>;
		/** How many rows to hold while the answer is read, so nothing moves when it lands. */
		reserve: number;
		/** The screen, from its answer and the league's host. */
		children: Snippet<[T, LeagueHost]>;
	}

	let { id, screen, title, read, reserve, children }: Props = $props();

	/** The league as the page names it: from the switch's list, else from the account's leagues. */
	type Head = Pick<AttachedLeague, 'host' | 'name' | 'team_name' | 'standing'>;

	let advice = $state<T | null>(null);
	let leaguesRead = $state<ReadState>('pending');
	/** The league from the account's list when the switch's list lacks it. */
	let listed = $state<Head | null>(null);
	let signedOut = $state(false);
	/** The API's sentence when it has no answer for this league. */
	let refusal = $state<string | null>(null);
	/** A later read failed: the page keeps the last answer and says so. */
	let problem = $state<string | null>(null);
	let now = $state(new Date());

	// The page is created per league ({#key} in the route), so its id is fixed for its life.
	// svelte-ignore state_referenced_locally
	followSwitch(id, (league) => tabHref(screen, league));

	const switchLeague = $derived(siteContext.leagues.find((l) => l.id === id) ?? null);
	const head = $derived<Head | null>(switchLeague ?? listed);

	async function readAnswer(): Promise<void> {
		try {
			advice = await read();
			now = new Date();
			problem = null;
			refusal = null;
		} catch (error) {
			const failure = readFailure(error, advice !== null);
			if (failure.kind === 'signed-out') signedOut = true;
			else if (failure.kind === 'stale') problem = failure.sentence;
			else refusal = failure.sentence;
		}
	}

	/** Names the league: the switch's list first, the account's leagues when it lacks it. */
	async function readLeagues(): Promise<void> {
		try {
			await siteContext.load();
			if (!siteContext.leagues.some((l) => l.id === id)) {
				listed = (await leagueApi.attached()).find((l) => l.id === id) ?? null;
			}
			leaguesRead = 'done';
		} catch {
			leaguesRead = 'failed';
		}
	}

	/** The answer every minute; the league's name until it has been read. */
	function readAll(): void {
		void readAnswer();
		if (leaguesRead !== 'done') void readLeagues();
	}

	onMount(() => {
		readAll();
		const timer = setInterval(readAll, POLL_MS);
		return () => clearInterval(timer);
	});

	const view = $derived(
		screenView({
			leagues: leaguesRead,
			known: head !== null,
			answered: advice !== null
		})
	);
	const name = $derived(head ? followedName(head) : 'Your league');
	const standing = $derived(head?.standing ? `${head.team_name}, ${standingWords(head)}.` : '');
</script>

<svelte:head>
	<title>{title} · {name} · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title={TAB_LABELS[screen]} active="league">
	{#if signedOut}
		<div class="pad">
			<EmptyState title={signInTitle(screen)} line={LINES.signInLine}>
				{#snippet actions()}<Verb href={leagueApi.signInUrl(tabHref(screen, id))}
						>{LINES.signIn}</Verb
					>{/snippet}
			</EmptyState>
		</div>
	{:else if view === 'missing'}
		<div class="pad">
			<EmptyState title={LINES.missingTitle} line={LINES.missingLine}>
				{#snippet actions()}<Verb href={links.leagueNew()}>{LINES.follow}</Verb>{/snippet}
			</EmptyState>
		</div>
	{:else}
		<main class="league">
			<header class="lead">
				<div class="title"><DisplayTitle size="page">{name}</DisplayTitle></div>
				<p class="sub">
					<span class="standing">{standing}</span>
					{#if advice}
						<span class="read" role="status"
							>{head ? readAgoLine(head.host, advice.read_at, now) : ''}
							{refreshedWords(advice.order_basis, advice.refreshed)}</span
						>
					{/if}
				</p>
			</header>
			<LeagueTabs {id} current={screen} />
			{#if refusal}
				<Panel edge="loss" padding="sm"><ProblemLine>{refusal}</ProblemLine></Panel>
			{:else if view === 'leagues-failed'}
				<Panel edge="loss" padding="sm"><ProblemLine>{LINES.leaguesUnread}</ProblemLine></Panel>
			{:else if view === 'ready' && advice && head}
				{#if problem}
					<Panel edge="loss" padding="sm"><ProblemLine>{problem}</ProblemLine></Panel>
				{/if}
				{@render children(advice, head.host)}
			{:else}
				<div class="reserve" aria-busy="true" aria-label={LINES.reading}>
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
			gap: var(--s-3);
			padding: var(--s-3) var(--s-4) var(--s-5);
		}

		/* One line for the league's name on a phone, so the decision and the first row stay in view. */
		/* The standing is the league page's: here the stamps say what the screen was read from. */
		.standing {
			display: none;
		}

		.title :global(h2) {
			display: block;
			overflow: hidden;
			white-space: nowrap;
			text-overflow: ellipsis;
		}

		.pad {
			padding: var(--s-4) var(--s-4) 0;
		}
	}
</style>

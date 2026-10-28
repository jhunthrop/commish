<script lang="ts" generics="T extends { read_at: string }">
	import { onMount, type Snippet } from 'svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { links } from '#lib/site/links.ts';
	import { ApiError, leagueApi, type AttachedLeague, type LeagueHost } from '../api.ts';
	import { followSwitch } from '../follow-switch.svelte.ts';
	import {
		POLL_MS,
		READING_NOW,
		followedName,
		readAgoLine,
		readNowWords,
		standingWords
	} from '../model.ts';
	import { zoneLine } from '#lib/format/clock.ts';
	import { LEAGUE_HOME } from '#lib/ui/nav.ts';
	import { screenSection } from '#lib/ui/rail-league.ts';
	import { tabHref } from './tabs.ts';
	import { readFailure, screenView, type ReadState } from './state.ts';
	import { leagueScreens } from './tab-list.ts';
	import { LINES, SCREEN_TITLES, signInTitle, type LeagueScreen } from './words.ts';

	/** One in-season screen of a followed league: the league's title with its read and order stamps,
	 * and the screen's answer once read (reserved rows until then, the API's own sentence when it
	 * has no answer, a sentence when the account's leagues cannot be read); the rail is the way
	 * between the league's pages. Read on
	 * open and once a minute while open, as the league page is; a failed read of the account's
	 * leagues is tried again with it. The answer carries every face and page, so no board is read. Opening it selects its league in the shell's
	 * switch; switching there opens this screen of the league switched to. */
	interface Props {
		id: string;
		screen: LeagueScreen;
		/** The page's title in the browser's tab. */
		title: string;
		/** What the answer was read from, beside the read's age: the order and when it was refreshed. */
		stamp: (answer: T) => string;
		/** Reads the screen's answer. */
		read: () => Promise<T>;
		/** How many rows to hold while the answer is read, so nothing moves when it lands. */
		reserve: number;
		/** The head as one line in body type, the member's team, record and the read stamp, with no
		 * league title: the bar's switch names the league (the Trades screen, Lane 268). */
		oneLine?: boolean;
		/** The screen, from its answer, the league's host, the instant the answer was read, in
		 * ms (the page's one clock, which the screen draws at), and a way to read the answer again. */
		children: Snippet<[T, LeagueHost, number, () => void]>;
	}

	let { id, screen, title, stamp, read, reserve, oneLine = false, children }: Props = $props();

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
	/** The refusal is a team missing from the last read: the host can be read again from here. */
	let noTeam = $state(false);
	let rereading = $state(false);
	let now = $state(new Date());
	/** The member's zone, named once beside the stamps when it is not Eastern. */
	const zone = zoneLine();

	// The page is created per league ({#key} in the route), so its id is fixed for its life.
	// svelte-ignore state_referenced_locally
	// A league switched to whose phase has no such screen (before its draft, after its season) opens
	// on its league page.
	followSwitch(id, (league) => {
		const to = siteContext.leagues.find((l) => l.id === league);
		return to && !leagueScreens(to).includes(screen)
			? tabHref(LEAGUE_HOME, league)
			: tabHref(screen, league);
	});

	const switchLeague = $derived(siteContext.leagues.find((l) => l.id === id) ?? null);
	const head = $derived<Head | null>(switchLeague ?? listed);

	async function readAnswer(): Promise<void> {
		try {
			advice = await read();
			now = new Date();
			problem = null;
			refusal = null;
			noTeam = false;
		} catch (error) {
			const failure = readFailure(error, advice !== null);
			if (failure.kind === 'signed-out') signedOut = true;
			else if (failure.kind === 'stale') problem = failure.sentence;
			else {
				refusal = failure.sentence;
				noTeam = failure.kind === 'no-team';
			}
		}
	}

	/** Reads the league from its host again (the league page's refresh), then this screen. */
	async function readHost(): Promise<void> {
		rereading = true;
		try {
			await leagueApi.refresh(id);
			await readAnswer();
		} catch (error) {
			refusal = error instanceof ApiError ? error.message : LINES.unreadable;
		} finally {
			rereading = false;
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

<Shell title={SCREEN_TITLES[screen]} active={screenSection(screen)} league={id}>
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
		<main class="league" class:one-line={oneLine}>
			<header class="lead">
				{#if !oneLine}<div class="title">
						<DisplayTitle size="page" wrap>{name}</DisplayTitle>
					</div>{/if}
				<p class="sub">
					<span class="standing">{standing}</span>
					{#if advice}
						<span class="read" role="status"
							>{head ? readAgoLine(head.host, advice.read_at, now) : ''}
							{stamp(advice)}
							{zone ?? ''}</span
						>
					{/if}
				</p>
			</header>
			{#if refusal}
				<Panel edge="loss" padding="sm">
					<div class="refused">
						<ProblemLine>{refusal}</ProblemLine>
						{#if noTeam && head}
							<Verb onclick={() => void readHost()} disabled={rereading}
								>{rereading ? READING_NOW : readNowWords(head.host)}</Verb
							>
						{/if}
					</div>
				</Panel>
			{:else if view === 'leagues-failed'}
				<Panel edge="loss" padding="sm"><ProblemLine>{LINES.leaguesUnread}</ProblemLine></Panel>
			{:else if view === 'ready' && advice && head}
				{#if problem}
					<Panel edge="loss" padding="sm"><ProblemLine>{problem}</ProblemLine></Panel>
				{/if}
				{@render children(advice, head.host, now.getTime(), () => void readAnswer())}
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

	/* One line in body type over a dense screen (Lane 268): the rows take the height. */
	.one-line {
		gap: 6px;
		padding-top: var(--s-2);
	}

	.one-line .sub {
		margin: 0;
		font-size: var(--t-sm);
		line-height: 1.35;
	}

	.one-line .standing {
		font-weight: 600;
		color: var(--ink);
	}

	.refused {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
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

		/* The standing is the league page's: here the stamps say what the screen was read from. */
		.standing {
			display: none;
		}

		.one-line {
			gap: var(--s-2);
			padding-top: var(--s-2);
		}

		.one-line .read {
			font-size: var(--t-xs);
		}

		.pad {
			padding: var(--s-4) var(--s-4) 0;
		}
	}
</style>

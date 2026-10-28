<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { links } from '#lib/site/links.ts';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import { LEAGUE_HOME } from '#lib/ui/nav.ts';
	import Panel from '#lib/ui/Panel.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { screenSection } from '#lib/ui/rail-league.ts';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { leagueApi, type AttachedLeague } from '../api.ts';
	import { POLL_MS } from '../model.ts';
	import { hasStatus, HTTP_STATUS } from '#lib/api/status.ts';
	import { MOVE_LINES } from './move.ts';
	import {
		EVERY,
		closeEvery,
		confirmEveryWords,
		everyLine,
		everyOutcome,
		everyReport,
		makeEvery,
		NONE_READY,
		planEvery,
		plannedChanges,
		stillReadingWords,
		readingEveryWords,
		readyEntries,
		setEveryWords,
		settingEveryWords,
		type BlockReport,
		type MoveEntry
	} from './every-lineup.ts';
	import LineupBlock from './LineupBlock.svelte';
	import { leagueScreens } from './tab-list.ts';
	import { tabHref } from './tabs.ts';
	import { LINES, signInTitle } from './words.ts';

	/** The member's every-league Lineup (Lane 257, B262): one block per league the account follows, in
	 * the account's order, each its league's own Lineup, and one verb over them, Make every change,
	 * which plans each league's move, shows each in its league, and on the member's one confirmation
	 * makes each with its own token, one league at a time, then says in each league what it came to.
	 * No league attached is the follow page; one league is that league's own Lineup. */

	/** Where the page's verb is: at rest, planning, waiting on the confirmation, sending, or said. */
	type Phase = 'idle' | 'planning' | 'confirm' | 'sending' | 'reported';

	let leagues = $state<readonly AttachedLeague[] | null>(null);
	let failed = $state(false);
	let signedOut = $state(false);
	let phase = $state<Phase>('idle');
	/** What the moves came to, once made. */
	let report = $state<string | null>(null);
	/** Each league's block as it last said, by league id. */
	let reports = $state<Readonly<Record<string, BlockReport>>>({});

	/** The account's leagues, in its order; none or one sends the member to the page that is theirs. */
	async function readLeagues(): Promise<void> {
		try {
			const read = await leagueApi.attached();
			failed = false;
			const [only] = read;
			if (read.length === 0) await goto(links.leagueNew(), { replaceState: true });
			else if (read.length === 1 && only !== undefined)
				await goto(ownPage(only), { replaceState: true });
			else leagues = read;
		} catch (error) {
			if (hasStatus(error, HTTP_STATUS.unauthorized)) signedOut = true;
			else failed = true;
		}
	}

	/** One league's page: its Lineup, or its league page in a phase with no Lineup. */
	function ownPage(league: AttachedLeague): string {
		return leagueScreens(league).includes('start')
			? tabHref('start', league.id)
			: tabHref(LEAGUE_HOME, league.id);
	}

	onMount(() => {
		void siteContext.load();
		void readLeagues();
		// A failed read of the account's leagues is tried again with the minute, as a screen's is.
		const timer = setInterval(() => {
			if (failed) void readLeagues();
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	const all = $derived(leagues === null ? [] : leagues.map((l) => reports[l.id]));
	const answered = $derived(
		all.length > 0 && all.every((r) => r !== undefined && r.kind !== 'reading')
	);
	/** The leagues not yet answered: the verb waits on them, so no league is ever left out of it. */
	const reading = $derived(all.filter((r) => r === undefined || r.kind === 'reading').length);
	const entries = $derived(all.flatMap((r): MoveEntry[] => (r?.entry ? [r.entry] : [])));
	const elsewhere = $derived(
		(leagues ?? []).filter((l) => reports[l.id]?.kind === 'elsewhere').map((l) => l.host)
	);
	/** The leagues the verb is moving, fixed when it is pressed, so a block that re-reads meanwhile
	 * leaves the moves as planned. */
	let moving = $state.raw<readonly MoveEntry[]>([]);
	const movingHosts = $derived(moving.map((e) => e.host));
	/** The moves the member is asked to confirm: the leagues whose plan is ready, and their changes as
	 * planned (review L2). */
	const ready = $derived(phase === 'confirm' ? readyEntries(moving) : []);
	const readyChanges = $derived(plannedChanges(ready));

	async function start(): Promise<void> {
		// One run at a time, and only once every league has answered (review M1, L3).
		if (phase !== 'idle' || reading > 0) return;
		moving = entries;
		report = null;
		phase = 'planning';
		await planEvery(moving);
		phase = 'confirm';
	}

	async function confirm(): Promise<void> {
		if (phase !== 'confirm') return;
		phase = 'sending';
		await makeEvery(moving);
		report = everyReport(everyOutcome(moving));
		phase = 'reported';
	}

	function close(): void {
		closeEvery(moving);
		moving = [];
		report = null;
		phase = 'idle';
	}

	const held = $derived(phase === 'planning' || phase === 'confirm' || phase === 'sending');
</script>

<svelte:head>
	<title>{EVERY.title} · Commish</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Shell title={EVERY.title} active={screenSection('start')}>
	{#if signedOut}
		<div class="pad">
			<EmptyState title={signInTitle('start')} line={LINES.signInLine}>
				{#snippet actions()}<Verb href={leagueApi.signInUrl(resolve('/league'))}
						>{LINES.signIn}</Verb
					>{/snippet}
			</EmptyState>
		</div>
	{:else}
		<main class="every">
			<header class="lead">
				<DisplayTitle size="page" wrap>{EVERY.title}</DisplayTitle>
			</header>
			{#if failed}
				<Panel edge="loss" padding="sm"><ProblemLine>{LINES.leaguesUnread}</ProblemLine></Panel>
			{:else if leagues !== null}
				<Panel as="section" label={EVERY.panel} edge="accent" padding="sm">
					<div class="call" aria-live="polite">
						{#if phase === 'idle'}
							<p class="line" class:quiet={!answered}>
								{answered ? everyLine(leagues.length, entries.length, elsewhere) : LINES.reading}
							</p>
							{#if reading > 0}
								<Verb disabled>{stillReadingWords(reading)}</Verb>
							{:else if entries.length > 0}
								<Verb onclick={() => void start()}>{EVERY.verb}</Verb>
							{/if}
						{:else if phase === 'planning'}
							<p class="line quiet">{readingEveryWords(movingHosts)}</p>
						{:else if phase === 'confirm'}
							{#if ready.length > 0}
								<p class="line">{confirmEveryWords(readyChanges, ready.length)}</p>
								<div class="actions">
									<Verb onclick={() => void confirm()}
										>{setEveryWords(
											ready.map((e) => e.host),
											ready.length
										)}</Verb
									>
									<Quiet onclick={close}>{MOVE_LINES.notNow}</Quiet>
								</div>
							{:else}
								<p class="line">{NONE_READY}</p>
								<Quiet onclick={close}>{MOVE_LINES.done}</Quiet>
							{/if}
						{:else if phase === 'sending'}
							<p class="line quiet">{settingEveryWords(movingHosts)}</p>
						{:else}
							<p class="line" role="status">{report}</p>
							<Quiet onclick={close}>{MOVE_LINES.done}</Quiet>
						{/if}
					</div>
				</Panel>
				{#each leagues as league (league.id)}
					<LineupBlock
						{league}
						{held}
						onstate={(r: BlockReport) => (reports = { ...reports, [r.id]: r })}
						onsignedout={() => (signedOut = true)}
					/>
				{/each}
			{:else}
				<div class="reserve" aria-busy="true" aria-label={LINES.reading}></div>
			{/if}
		</main>
	{/if}
</Shell>

<style>
	.pad {
		padding: var(--s-4) var(--s-5) 0;
	}

	.every {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-4) var(--s-5) var(--s-6);
	}

	.call {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
	}

	.line {
		margin: 0;
		max-width: 72ch;
		font-size: var(--t-md);
		font-weight: 600;
		line-height: 1.4;
	}

	.quiet {
		color: var(--ink-2);
		font-weight: 400;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
	}

	.reserve {
		height: 74px;
		border-radius: var(--r-md);
		background: var(--surface);
	}

	@media (max-width: 760px) {
		.every {
			gap: var(--s-3);
			padding: var(--s-3) var(--s-4) var(--s-5);
		}

		.pad {
			padding: var(--s-4) var(--s-4) 0;
		}
	}
</style>

<script lang="ts">
	import { PUBLIC_API_URL } from '$app/env/public';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { hasFeature } from '#lib/account/features.ts';
	import { apiClient } from '#lib/api/client.ts';
	import OneLeagueFree from '#lib/league/OneLeagueFree.svelte';
	import { links } from '#lib/site/links.ts';
	import Label from '#lib/ui/Label.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { choose, switchProblem } from './choose.svelte.ts';
	import { signInReturn } from './sign-in.ts';
	import { followThen } from './then-path.ts';
	import { siteContext } from './context.svelte.ts';
	import { FOLLOW_ANOTHER, FOLLOW_FIRST, leagueLine, menuLast, phaseWords } from './menu-words.ts';
	import { FALLBACK_BOARDS, runBoards, type RunBoard } from './run-boards.ts';
	import { DEFAULT_CONTEXT_FORMAT, leagueName } from './words.ts';

	/** The switch's menu: every league the account follows, its host and scoring in words, one tap
	 * each; a format with no league; then the selected league's page and the way to follow another,
	 * or for a free account with its one league, what more leagues come with. Signed out it is the
	 * formats and the way to sign in. Loaded on the first intent to open the switch, with how it
	 * closes: a tap outside every control that opens it, Escape, or a page it opens. */

	/** What marks a control that opens the menu (the switch): its own tap opens and closes it. */
	const OPENER = '[data-opens-leagues]';

	afterNavigate(() => {
		siteContext.open = false;
	});

	function onWindowPointer(event: PointerEvent): void {
		if (!siteContext.open || !(event.target instanceof Element)) return;
		if (event.target.closest(OPENER)) return;
		siteContext.open = false;
	}

	function onKey(event: KeyboardEvent): void {
		if (!siteContext.open || event.key !== 'Escape') return;
		event.preventDefault();
		siteContext.open = false;
		document.querySelector<HTMLElement>('[aria-controls="league-menu"]')?.focus();
	}

	/** The boards the run carries, offered with no league. Read when the menu opens; when the file
	 * fails or takes too long the three the api always accepts stand in, and the next opening tries
	 * the file once more. */
	let boards = $state<readonly RunBoard[]>([]);
	let boardsLoaded = false;
	let boardsAsked = false;

	function readBoards(): void {
		if (boardsLoaded || boardsAsked) return;
		boardsAsked = true;
		runBoards()
			.then((loaded) => {
				boards = loaded;
				boardsLoaded = true;
			})
			.catch(() => {
				boards = FALLBACK_BOARDS;
			})
			.finally(() => (boardsAsked = false));
	}

	$effect(() => {
		if (siteContext.open) readBoards();
	});

	/** Signed out, the last row signs in to follow a league: back to the follow page, or the league
	 * screen the visitor was on, never the page they opened the menu from (then-path.ts). */
	const signInHref = $derived(
		apiClient(PUBLIC_API_URL).signInUrl(
			signInReturn(followThen(page.url.pathname + page.url.search))
		)
	);
	const many = $derived(hasFeature(siteContext.features, 'many_leagues'));
	const last = $derived(menuLast(siteContext.leagues.length, many));
	const league = $derived(siteContext.league);
	/** Each league's phase beside its name, only when the account's leagues differ. */
	const phases = $derived(phaseWords(siteContext.leagues));
	/** The pressed format: the chosen format with no league, PPR before any choice. */
	const noLeagueFormat = $derived(
		league === null ? (siteContext.format ?? DEFAULT_CONTEXT_FORMAT) : null
	);
</script>

<svelte:window onpointerdown={onWindowPointer} onkeydown={onKey} />

<div class="menu">
	{#if siteContext.leagues.length > 0}
		<section class="leagues" aria-label="Your leagues">
			<Label>Your leagues</Label>
			{#each siteContext.leagues as candidate (candidate.id)}
				<button
					type="button"
					class="league"
					aria-pressed={candidate.id === league?.id}
					onclick={() => void choose({ league: candidate.id })}
				>
					<span class="name"
						>{leagueName(candidate)}{#if phases.has(candidate.id)}<span class="phase"
								>{phases.get(candidate.id)}</span
							>{/if}</span
					>
					<span class="line">{leagueLine(candidate)}</span>
				</button>
			{/each}
		</section>
	{/if}

	<section class="formats" aria-label="Scoring with no league">
		<Label>{siteContext.leagues.length > 0 ? 'No league, just a format' : 'Scoring'}</Label>
		<!-- The menu's own choices, not the page chips: the board chunk stays off every page that only
		     opens the switch, and the page's styles keep their place in its first paint. -->
		<div class="formats-row" role="group" aria-label="Scoring">
			{#each boards as board (board.format)}
				<button
					type="button"
					class="choice"
					aria-pressed={board.format === noLeagueFormat}
					onclick={() => void choose({ format: board.format })}>{board.label}</button
				>
			{/each}
		</div>
	</section>

	{#if switchProblem.text}<ProblemLine>{switchProblem.text}</ProblemLine>{/if}

	<div class="foot">
		{#if !siteContext.signedIn}
			<Quiet size="sm" href={signInHref}>Sign in to follow your league</Quiet>
		{:else}
			{#if league}
				<Quiet size="sm" href={links.league(league.id)}>League page</Quiet>
			{/if}
			<!-- The last row (spec 2026-10-16 §2): the switch is the one place a league is chosen. -->
			{#if last === 'one-league-free'}
				<OneLeagueFree />
			{:else}
				<Quiet size="sm" href={links.leagueNew()}
					>{last === 'follow-first' ? FOLLOW_FIRST : FOLLOW_ANOTHER}</Quiet
				>
			{/if}
		{/if}
	</div>
</div>

<style>
	.menu {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		padding: var(--s-3);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--s-2);
	}

	.league {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: var(--s-2) var(--s-3);
		border: 1px solid transparent;
		border-left: 3px solid transparent;
		border-radius: var(--r-sm);
		background: none;
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.league:hover {
		background: var(--surface);
	}

	.league[aria-pressed='true'] {
		border-left-color: var(--accent);
		background: var(--surface);
	}

	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	/* The phase sits on the name's line, at its end, in the line's quiet ink. */
	.phase {
		margin-left: var(--s-2);
		font-size: var(--t-sm);
		font-weight: 500;
		color: var(--ink-2);
		white-space: nowrap;
	}

	.line {
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	/* The formats as one segmented row, pressed in ink as a chip is. */
	.formats-row {
		display: flex;
		gap: 4px;
		padding: 3px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--surface);
	}

	.choice {
		flex: 1;
		height: 32px;
		border: 0;
		border-radius: var(--r-pill);
		background: none;
		color: var(--ink-2);
		font: inherit;
		font-size: var(--t-sm);
		font-weight: 500;
		cursor: pointer;
	}

	.choice:hover {
		color: var(--ink);
	}

	.choice[aria-pressed='true'] {
		background: var(--ink);
		color: var(--bg);
	}

	.foot {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--s-2);
		padding-top: var(--s-3);
		border-top: 1px solid var(--line);
	}
</style>

<script lang="ts">
	import { PUBLIC_API_URL } from '$app/env/public';
	import { page } from '$app/state';
	import { hasFeature } from '#lib/account/features.ts';
	import { apiClient } from '#lib/api/client.ts';
	import OneLeagueFree from '#lib/league/OneLeagueFree.svelte';
	import { links } from '#lib/site/links.ts';
	import { FORMAT_LABELS } from '#lib/sheet/format.ts';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Label from '#lib/ui/Label.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import { siteContext } from './context.svelte.ts';
	import { CONTEXT_FORMATS, leagueLine } from './menu-words.ts';
	import { DEFAULT_CONTEXT_FORMAT, leagueName } from './words.ts';

	/** The switch's menu: every league the account follows, its host and scoring in words, one tap
	 * each; a format with no league; then the selected league's page and the way to follow another,
	 * or for a free account with its one league, what more leagues come with. Signed out it is the
	 * formats and the way to sign in. Loaded on the first intent to open the switch. */

	const signInHref = $derived(apiClient(PUBLIC_API_URL).signInUrl(page.url.pathname));
	const many = $derived(hasFeature(siteContext.features, 'many_leagues'));
	const league = $derived(siteContext.league);
	/** The format chips' pressed one: the chosen format with no league, PPR before any choice. */
	const noLeagueFormat = $derived(
		league === null ? (siteContext.format ?? DEFAULT_CONTEXT_FORMAT) : null
	);
</script>

<div class="menu">
	{#if siteContext.leagues.length > 0}
		<section class="leagues" aria-label="Your leagues">
			<Label>Your leagues</Label>
			{#each siteContext.leagues as candidate (candidate.id)}
				<button
					type="button"
					class="league"
					aria-pressed={candidate.id === league?.id}
					onclick={() => void siteContext.choose({ league: candidate.id })}
				>
					<span class="name">{leagueName(candidate)}</span>
					<span class="line">{leagueLine(candidate)}</span>
				</button>
			{/each}
		</section>
	{/if}

	<section class="formats" aria-label="Scoring with no league">
		<Label>{siteContext.leagues.length > 0 ? 'No league, just a format' : 'Scoring'}</Label>
		<ChipGroup label="Scoring">
			{#each CONTEXT_FORMATS as format (format)}
				<Chip
					pressed={format === noLeagueFormat}
					onclick={() => void siteContext.choose({ format })}>{FORMAT_LABELS[format]}</Chip
				>
			{/each}
		</ChipGroup>
	</section>

	{#if siteContext.problem}<ProblemLine>{siteContext.problem}</ProblemLine>{/if}

	<div class="foot">
		{#if !siteContext.signedIn}
			<Quiet size="sm" href={signInHref}>Sign in to follow your league</Quiet>
		{:else}
			{#if league}
				<Quiet size="sm" href={links.league(league.id)}>League page</Quiet>
			{/if}
			{#if many || siteContext.leagues.length === 0}
				<Quiet size="sm" href={links.leagueNew()}
					>{siteContext.leagues.length === 0
						? 'Follow your league'
						: 'Follow another league'}</Quiet
				>
			{:else}
				<OneLeagueFree />
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

	.line {
		font-size: var(--t-sm);
		color: var(--ink-2);
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

<script lang="ts">
	import { MOCK_VERB, type LeaguePhase } from '#lib/ui/nav.ts';
	import { zoneLine } from '#lib/league/phase-words.ts';
	import { links } from '#lib/site/links.ts';
	import Label from '#lib/ui/Label.svelte';
	import Panel from '#lib/ui/Panel.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import type { LeagueStanding } from './api.ts';
	import {
		ADVISOR_VERB,
		NEXT_DRAFT,
		SHEET_LINK,
		TURNS_AFTER_DRAFT,
		draftLine,
		finalStanding
	} from './phase-words.ts';

	/** The league page's word on its season when no game is on (spec 2026-10-16 §3): before the draft
	 * its time on the member's clock and that the site turns to the season after it, with the one
	 * verb (the Advisor on draft day, a mock draft before); after the season where the team finished
	 * and the next draft's verbs. Nothing in season. */
	interface Props {
		phase: LeaguePhase;
		draftAt: string | null;
		team: string;
		standing: LeagueStanding | null;
		/** The mock draft that drafts this league, else a new one. */
		mockHref: string;
		now: Date;
	}

	let { phase, draftAt, team, standing, mockHref, now }: Props = $props();

	const zone = zoneLine();
</script>

{#if phase === 'pre_draft' || phase === 'draft_day'}
	<Panel edge="accent" padding="sm">
		<div class="season">
			<div class="words">
				<p class="lead">{draftLine(draftAt, now)}</p>
				<p class="line">{TURNS_AFTER_DRAFT} {zone ?? ''}</p>
			</div>
			{#if phase === 'draft_day'}
				<Verb href={links.companionNew()}>{ADVISOR_VERB}</Verb>
			{:else}
				<Verb href={mockHref}>{MOCK_VERB}</Verb>
			{/if}
		</div>
	</Panel>
{:else if phase === 'offseason'}
	<Panel padding="sm">
		<div class="season">
			<div class="words">
				<p class="lead">{finalStanding(team, standing)}</p>
				<Label>{NEXT_DRAFT}</Label>
			</div>
			<div class="verbs">
				<Quiet size="sm" href={links.sheet()}>{SHEET_LINK}</Quiet>
				<Verb href={mockHref}>{MOCK_VERB}</Verb>
			</div>
		</div>
	</Panel>
{/if}

<style>
	.season {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
	}

	.words {
		display: flex;
		flex-direction: column;
		gap: var(--s-1);
		min-width: 0;
	}

	.lead {
		margin: 0;
		font-weight: 600;
	}

	.line {
		margin: 0;
		color: var(--ink-2);
		font-size: var(--t-sm);
	}

	.verbs {
		display: flex;
		align-items: center;
		gap: var(--s-3);
	}
</style>

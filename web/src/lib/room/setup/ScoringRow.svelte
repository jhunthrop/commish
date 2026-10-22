<script lang="ts">
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { LeagueSettings } from '../api.ts';
	import CustomRules from './CustomRules.svelte';
	import { rulesFrom, type ScoringRules } from './rules.ts';
	import { SCORING_CHOICES } from './setup.ts';
	import SetupRow from './SetupRow.svelte';

	type Scoring = LeagueSettings['scoring'];

	/** The scoring row: a preset in one tap, or the league's own rules (brought in from its platform
	 * or entered by hand) for an account with custom_scoring. Signed out, the row says to sign in. */
	interface Props {
		scoring: Scoring;
		/** The account has custom_scoring (from /me, never a plan name). */
		exactRules: boolean;
		/** Where a signed-out drafter signs in, null when signed in. */
		signInTo: string | null;
		onchange: (scoring: Scoring) => void;
	}

	let { scoring, exactRules, signInTo, onchange }: Props = $props();

	/** The last rules on the form, kept while a preset is tried, so going back loses nothing. */
	let kept = $state<ScoringRules | null>(null);
	let asked = $state(false);
	const own = $derived(scoring.custom !== null);

	function chooseOwn(): void {
		if (!exactRules) {
			asked = true;
			return;
		}
		onchange({ preset: null, custom: kept ?? rulesFrom(scoring.preset ?? null) });
	}

	function setRules(rules: ScoringRules): void {
		kept = rules;
		onchange({ preset: null, custom: rules });
	}
</script>

<SetupRow label="Scoring" note={own ? "your league's own rules" : undefined}>
	<!-- Loose, so the five chips wrap inside a phone's width. -->
	<ChipGroup label="Scoring" variant="loose">
		{#each SCORING_CHOICES as c (c.preset)}
			<Chip
				pressed={!own && !asked && scoring.preset === c.preset}
				onclick={() => {
					if (scoring.custom) kept = scoring.custom;
					asked = false;
					onchange({ preset: c.preset, custom: null });
				}}>{c.label}</Chip
			>
		{/each}
		<Chip pressed={own || asked} onclick={chooseOwn}>Your league's</Chip>
	</ChipGroup>
	{#if asked && !exactRules && signInTo !== null}
		<span class="pass">
			Sign in to follow your league and bring in its scoring. Until then a mock drafts on PPR.
			<Quiet size="sm" href={signInTo}>Sign in</Quiet>
		</span>
	{/if}
</SetupRow>
{#if own && scoring.custom}
	<div class="rules">
		<CustomRules rules={scoring.custom} onchange={setRules} />
	</div>
{/if}

<style>
	.pass {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	/* The bottom room clears the phone's fixed action bar under the last field. */
	.rules {
		padding: var(--s-3) 0 var(--s-7);
	}
</style>

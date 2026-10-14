<script lang="ts">
	import { resolve } from '$app/paths';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import type { LeagueSettings } from '../api.ts';
	import CustomRules from './CustomRules.svelte';
	import { rulesFrom, type ScoringRules } from './rules.ts';
	import { SCORING_CHOICES } from './setup.ts';
	import SetupRow from './SetupRow.svelte';

	type Scoring = LeagueSettings['scoring'];

	/** The scoring row: a preset in one tap, or the league's own rules with the Draft Pass (brought in
	 * from its host or entered by hand). Without the pass the row says where the exact rules come
	 * from. */
	interface Props {
		scoring: Scoring;
		/** The account has custom_scoring (from /me, never a plan name). */
		exactRules: boolean;
		onchange: (scoring: Scoring) => void;
	}

	let { scoring, exactRules, onchange }: Props = $props();

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

<SetupRow label="Scoring" note={own ? 'every rule on your league' : undefined}>
	<ChipGroup label="Scoring">
		{#each SCORING_CHOICES as c (c.preset)}
			<Chip
				pressed={!own && scoring.preset === c.preset}
				onclick={() => {
					if (scoring.custom) kept = scoring.custom;
					asked = false;
					onchange({ preset: c.preset, custom: null });
				}}>{c.label}</Chip
			>
		{/each}
		<Chip pressed={own} onclick={chooseOwn}>Your league's</Chip>
	</ChipGroup>
	{#if asked && !exactRules}
		<span class="pass">
			Your league's exact scoring comes with the Draft Pass.
			<Quiet size="sm" href={resolve('/pass')}>See the Draft Pass</Quiet>
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

	.rules {
		padding: var(--s-3) 0 var(--s-4);
	}
</style>

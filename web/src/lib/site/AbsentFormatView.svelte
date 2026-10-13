<script lang="ts">
	import type { FormatChip } from '#lib/server/pages/format-route.ts';
	import type { AbsentFormatPage } from '#lib/server/pages/format-route.ts';
	import { runStampText, type RunStamp } from '#lib/run/stamp.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import FilterBar from '#lib/ui/FilterBar.svelte';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import FormatChips from './FormatChips.svelte';
	import SiteShell from './SiteShell.svelte';

	/** A format page for a format the chooser offers and this run does not carry: the chooser, and a
	 * line naming what the run has, with a way to each. */
	interface Props {
		page: AbsentFormatPage;
		run: RunStamp;
		/** The page's kind, as its title names it: "Board", "ADP". */
		noun: string;
		/** A format's page of this kind. */
		href: (formatId: string) => string;
	}

	let { page, run, noun, href }: Props = $props();

	const carried = $derived(page.formats.filter((chip) => chip.onRun));
	const carriedWords = $derived(carried.map((chip) => chip.label).join(' and '));
</script>

<svelte:head>
	<meta name="robots" content="noindex" />
</svelte:head>

<SiteShell title="{page.format.label} {noun}" {run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="absent">
		<PageHead title="{run.season} {noun}" />
		<FilterBar>
			<FormatChips
				formats={page.formats}
				current={page.format.id}
				href={(chip: FormatChip) => href(chip.id)}
			/>
		</FilterBar>
		<EmptyState
			title="{page.format.label} is not on this run"
			line="{runStampText(run)} ranks {carriedWords} only."
		>
			{#snippet actions()}
				{#each carried as chip (chip.id)}
					<Quiet href={href(chip.id)}>{chip.label} {noun}</Quiet>
				{/each}
			{/snippet}
		</EmptyState>
	</main>
</SiteShell>

<style>
	.absent {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-5);
		max-width: 900px;
	}

	@media (max-width: 760px) {
		.absent {
			padding: var(--s-4);
		}
	}
</style>

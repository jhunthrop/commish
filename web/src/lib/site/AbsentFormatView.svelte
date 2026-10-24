<script lang="ts">
	import type { AbsentFormatPage } from '#lib/server/pages/format-route.ts';
	import { runStampText, type RunStamp } from '#lib/run/stamp.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import { absentWords } from './absent.ts';
	import PageHead from '#lib/ui/PageHead.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import { followFormat } from '#lib/context/follow.svelte.ts';
	import SiteShell from './SiteShell.svelte';

	/** A format page for a format the chooser offers and this run does not carry: its scoring, which
	 * opens the league switch, and a line naming what the run has, with a way to each. */
	interface Props {
		page: AbsentFormatPage;
		run: RunStamp;
		/** The page's heading: "2026 Board", "Rest of 2026", "2026 ADP". */
		heading: string;
		/** A format's name for this kind of page, for the title and each way to a carried format. */
		name: (formatLabel: string) => string;
		/** A format's page of this kind. */
		href: (formatId: string) => string;
	}

	let { page, run, heading, name, href }: Props = $props();

	const carried = $derived(page.formats.filter((chip) => chip.onRun));
	// A context in a format the run carries opens that format's page.
	followFormat(
		() => page.format.id,
		() => carried.map((chip) => chip.id),
		(id) => href(id)
	);
	const words = $derived(
		absentWords(
			page.format.label,
			runStampText(run),
			carried.map((chip) => chip.label)
		)
	);
</script>

<SiteShell title={name(page.format.label)} head={page.head} {run}>
	{#snippet tail()}<Verb href={sectionHref('mock')}>Start a mock draft</Verb>{/snippet}
	<main class="absent">
		<PageHead title={heading} />
		<EmptyState title={words.title} line={words.line}>
			{#snippet actions()}
				{#each carried as chip (chip.id)}
					<Quiet href={href(chip.id)}>{name(chip.label)}</Quiet>
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

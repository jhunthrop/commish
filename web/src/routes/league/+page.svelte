<script lang="ts">
	import EveryLineup from '#lib/league/inseason/EveryLineup.svelte';
	import { LINES } from '#lib/league/inseason/words.ts';
	import { FLAGS } from '#lib/site/flags.ts';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import { sectionHref } from '#lib/ui/nav.ts';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
</script>

<!-- The member's every-league Lineup (Lane 257) while the in-season tools are on; with them off, the
     site's not-found in its own words, as a league's screens say it. -->
{#if FLAGS.in_season_tools}
	<EveryLineup />
{:else}
	<Shell title={LINES.notFoundBar} active={null}>
		<div class="pad">
			<EmptyState title={LINES.notFound} line={LINES.notFoundLine}>
				{#snippet actions()}<Verb href={sectionHref('board')}>{LINES.toBoard}</Verb>{/snippet}
			</EmptyState>
		</div>
	</Shell>
{/if}

<style>
	.pad {
		padding: var(--s-6) var(--s-5);
	}
</style>

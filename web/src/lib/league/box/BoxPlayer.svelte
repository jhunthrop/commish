<script lang="ts">
	import type { Snippet } from 'svelte';
	import { links } from '#lib/site/links.ts';
	import ClubMark from '#lib/ui/ClubMark.svelte';
	import Face from '#lib/ui/Face.svelte';
	import NameWords from '#lib/ui/NameWords.svelte';
	import TagChip from '#lib/ui/TagChip.svelte';
	import { tagMarks } from '#lib/sheet/tags.ts';
	import StatusPill from '../StatusPill.svelte';
	import { HELD } from '../inseason/words.ts';
	import { initialName, type BoxRow } from './box.ts';
	import BoxGame from './BoxGame.svelte';

	/** A box row's player cell (Lane 66d), shared by every box score: his face (a defense's club mark),
	 * his name on a line of its own, under it his club and Lane 63's status pill (his position and
	 * rank, and his status when the report lists him), your sheet's tags, and his game folded under
	 * the pill on a phone (or at every width in a compact box, its facts left out). A screen adds its
	 * own mark after the pill (after) and its own short line under it all (children). */
	interface Props {
		row: BoxRow;
		/** Your sheet's tags on him, as the league's rows mark them (review L7). */
		tags?: readonly string[];
		/** A narrow phone cell prints his short form, "A. Rodgers", never a cut surname (rereview N2). */
		shortOnPhone?: boolean;
		/** The trade builder's rows (Lane 66g): the game under the name at every width, without facts. */
		compact?: boolean;
		/** "Clears Wed" in the folded game, where the platform says it (Lane 66f). */
		clears?: string | null;
		/** Drawn on the club line after the pill. */
		after?: Snippet;
		/** The screen's own line under the name, as the phone and narrow screens fold it. */
		children?: Snippet;
	}

	let {
		row,
		tags = [],
		shortOnPhone = false,
		compact = false,
		clears = null,
		after,
		children
	}: Props = $props();
</script>

{#snippet named()}
	{#if shortOnPhone}<span class="full"><NameWords name={row.name} /></span><span class="short"
			>{initialName(row.name)}</span
		>{:else}<NameWords name={row.name} />{/if}
{/snippet}

<span class="pl">
	{#if row.face.mark && row.face.src !== null}
		<ClubMark src={row.face.src} alt={row.face.alt} size={32} />
	{:else}
		<Face src={row.face.src} name={row.name} size={32} />
	{/if}
	<span class="who">
		<span class="nm">
			{#if row.slug !== null}
				<a href={links.playerSeason(row.slug)}>{@render named()}</a>
			{:else}
				<b>{@render named()}</b>
			{/if}
		</span>
		<span class="club"
			><span>{row.club}</span>{#if row.pill}<StatusPill
					position={row.pill.position}
					positionRank={row.pill.rank ?? undefined}
					status={row.status}
				/>{/if}{@render after?.()}</span
		>
		{#if tags.length > 0 || row.held}
			<!-- Held is the sheet's Hold tag, said by the API: drawn when the sheet's own tags are not in. -->
			<span class="tags"
				>{#if row.held && tags.length === 0}<TagChip
						label={HELD}
					/>{/if}{#each tagMarks(tags) as mark (mark.label)}<TagChip
						label={mark.label}
						tone={mark.tone}
					/>{/each}</span
			>
		{/if}
		<span class="phone-game" class:compact><BoxGame {row} facts={!compact} {clears} /></span>
		{@render children?.()}
	</span>
</span>

<style>
	.pl {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		min-width: 0;
	}

	.who {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.nm {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 6px;
		row-gap: 2px;
	}

	.nm a,
	.nm b {
		font-weight: 600;
		color: var(--ink);
		text-decoration: none;
	}

	.nm a:hover {
		text-decoration: underline;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.club {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		font-size: var(--t-xs);
		font-weight: 500;
		letter-spacing: 0.03em;
		color: var(--ink-3);
	}

	.short {
		display: none;
	}

	.phone-game {
		display: none;
	}

	.phone-game.compact {
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: var(--t-xs);
		color: var(--ink-2);
	}

	@media (max-width: 760px) {
		/* A name's short form on a phone, where the row asks for it. */
		.full {
			display: none;
		}

		.short {
			display: inline;
			white-space: nowrap;
		}

		.phone-game {
			display: flex;
			flex-direction: column;
			gap: 1px;
			font-size: var(--t-xs);
			color: var(--ink-2);
		}
	}
</style>

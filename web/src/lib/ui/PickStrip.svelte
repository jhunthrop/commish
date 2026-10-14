<script lang="ts">
	import { lastName } from '#lib/format/draft.ts';
	import type { StripPick } from '#lib/types/room.ts';
	import Face from './Face.svelte';
	import Panel from './Panel.svelte';

	interface Props {
		/** The big number at the head: a count, or the newest pick. */
		lead: string;
		/** The two lines under it. */
		leadLines: readonly string[];
		picks: readonly StripPick[];
		/** Wider faces' columns when each carries more lines, widest when a line names a handle. */
		width?: 'sm' | 'md' | 'lg';
	}

	let { lead, leadLines, picks, width = 'sm' }: Props = $props();

	/** The face's size, base.css's --strip-face, which the strip's reserved height counts. */
	const STRIP_FACE = 36;
	/** The text lines the strip holds: each pick's name and the most lines under one. */
	const textLines = $derived(1 + Math.max(0, ...picks.map((p) => p.lines.length)));
</script>

<Panel padding="none">
	<div class="strip strip-height" style:--strip-text-lines={textLines}>
		<div class="lead">
			<b>{lead}</b>
			{#each leadLines as line, i (i)}<span>{line}</span>{/each}
		</div>
		<ol class="run {width}">
			{#each picks as pick (pick.key)}
				<li class:accent={pick.ring === 'accent'} class:strong={pick.strong}>
					<Face
						src={pick.player.headshot}
						name={pick.player.name}
						size={STRIP_FACE}
						ringed={pick.ring === 'accent'}
						marked={pick.ring === 'ink'}
					/>
					<b>{lastName(pick.player.name)}</b>
					{#each pick.lines as line, i (i)}<span>{line}</span>{/each}
				</li>
			{/each}
		</ol>
	</div>
</Panel>

<style>
	.strip {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		padding: var(--s-3) var(--fade-w) var(--s-3) var(--s-4);
		overflow-x: auto;
		min-block-size: var(--strip-h);
		box-sizing: border-box;
		/* At every width the last face fades, the cue that more of the strip scrolls in. */
		mask-image: var(--fade-end);
	}

	.lead {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-right: var(--s-3);
		border-right: 1px solid var(--line);
	}

	.lead b {
		font-family: var(--font-num);
		font-variant-numeric: tabular-nums;
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
	}

	.lead span {
		font-size: var(--t-xs);
		color: var(--ink-3);
		white-space: nowrap;
	}

	.run {
		display: flex;
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
		--strip-w: 58px;
	}

	.run.md {
		--strip-w: 66px;
	}

	.run.lg {
		--strip-w: 88px;
	}

	li {
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--strip-gap);
		/* At least the column's width, and as wide as its longest line: a name or a handle is shown
		   whole, never cut, and the strip scrolls. */
		min-inline-size: var(--strip-w);
		font-size: var(--t-xs);
		line-height: var(--strip-line);
		/* A name, a league member's handle among them, keeps its direction to itself. */
		unicode-bidi: isolate;
		color: var(--ink-3);
		text-align: center;
	}

	li b {
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		font-size: var(--t-xs);
	}

	li span {
		white-space: nowrap;
	}

	.accent span {
		color: var(--accent-text);
		font-weight: 600;
	}

	.strong b + span {
		color: var(--ink);
		font-weight: 500;
	}

	@media (max-width: 760px) {
		.strip {
			padding: var(--s-3);
		}
	}
</style>

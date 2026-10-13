<script lang="ts" module>
	/** Our board's numbers for him, the same ones the board prints. */
	export interface SheetRowBoard {
		/** Our rank on this format's board. */
		rank: number;
		/** His rank at his position on our board, the one the position pill prints everywhere. */
		positionRank: number;
		/** Where drafters take him on average, or null when he is not in our ADP window. */
		adp: number | null;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { draftersGap } from '#lib/format/draft.ts';
	import { fixed } from '#lib/format/number.ts';
	import type { Position } from '#lib/types/player.ts';
	import Face from './Face.svelte';
	import GapChip from './GapChip.svelte';
	import Icon from './Icon.svelte';
	import Label from './Label.svelte';
	import NoteLine from './NoteLine.svelte';
	import Place from './Place.svelte';
	import PositionPill from './PositionPill.svelte';
	import TagChip from './TagChip.svelte';
	import TierChip from './TierChip.svelte';
	import type { TagMark } from './tag.ts';

	interface Props {
		id: string;
		name: string;
		position: Position;
		team: string | null;
		headshot: string | null;
		/** His place on your sheet, the quiet number after the person. */
		place: number;
		/** Our board's numbers for him: undefined while our board loads, null when we do not rank
		 * him. The position pill only ever prints our board's rank. */
		board?: SheetRowBoard | null;
		/** His tier, printed as a chip where no strips are drawn (the All view). */
		tier?: number | null;
		tags: readonly TagMark[];
		note: string | null;
		/** The row is open: the editor below. */
		open?: boolean;
		/** Lifted by the keyboard: arrows move him until he is dropped. */
		lifted?: boolean;
		/** The handle is shown. Hidden while a search narrows the sheet. */
		movable?: boolean;
		/** Opens or closes the row, from its disclosure or a tap anywhere on it. */
		ontoggle?: () => void;
		/** Keys on the handle: Space or Enter lift and drop, arrows move, Escape puts him back. */
		ongripkeydown?: (event: KeyboardEvent) => void;
		/** Faces in the first screen load eagerly. */
		eager?: boolean;
		editor?: Snippet;
	}

	let {
		id,
		name,
		position,
		team,
		headshot,
		place,
		board,
		tier = null,
		tags,
		note,
		open = false,
		lifted = false,
		movable = true,
		ontoggle,
		ongripkeydown,
		eager = false,
		editor
	}: Props = $props();

	const editorId = $derived(`sheet-row-${id}`);
	const adpLabel = $derived(
		board?.adp === null || board?.adp === undefined ? 'Not in ADP' : `ADP ${fixed(board.adp)}`
	);
	const gap = $derived(board ? draftersGap(board.adp, board.rank) : null);

	/** A tap anywhere on the row opens it, except on its own controls and its open editor. */
	function onRowClick(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('button, a, input, textarea, label, [data-editor]')) return;
		if (window.getSelection()?.isCollapsed === false) return;
		ontoggle?.();
	}
</script>

<!-- What the row holds, before it opens. Always drawn, so the grid's columns never shift. -->
{#snippet marks(where: 'wide' | 'narrow')}
	<span class="marks {where}">
		{#each tags as tag (tag.label)}<TagChip label={tag.label} tone={tag.tone} />{/each}
		{#if note && where === 'narrow'}
			<span class="glyph" role="img" aria-label="Has a note"><Icon name="note" size={14} /></span>
		{/if}
	</span>
{/snippet}

<!-- data-row-id and data-grip are how the drag controller (lib/sheet/drag.ts) finds the rows and
	 their handles without a reactive update per frame. The row's disclosure is the control a
	 keyboard or a screen reader uses. The tap on the rest of the row is the same act for a finger. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
	class="row"
	class:open
	class:lifted
	class:noted={note !== null}
	data-row-id={id}
	onclick={onRowClick}
>
	{#if movable}
		<button
			type="button"
			class="grip"
			data-grip={id}
			aria-label="Move {name}, {place} on your sheet"
			aria-pressed={lifted}
			aria-keyshortcuts="Space ArrowUp ArrowDown Escape"
			onkeydown={ongripkeydown}
		>
			<Icon name="grip" size={18} />
		</button>
	{:else}
		<span></span>
	{/if}
	<Face src={headshot} size={40} loading={eager ? 'eager' : 'lazy'} />
	<span class="who">
		<span class="line">
			<span class="name">{name}</span>
			{@render marks('narrow')}
		</span>
		<span class="meta">
			<PositionPill {position} rank={board?.positionRank} />
			{#if tier !== null}<TierChip {tier} />{/if}
			{#if team}<span>{team}</span>{/if}
			{#if board !== undefined}<span class="narrow-gap"><GapChip {gap} /></span>{/if}
		</span>
		<!-- An open row's note is in its editor, so the line steps aside: typing never moves the
			 row under the finger. -->
		{#if note && !open}<span class="under"><NoteLine {note} /></span>{/if}
	</span>
	<span class="said">
		{#if note && !open}
			<span class="glyph" aria-hidden="true"><Icon name="note" size={14} /></span>
			<NoteLine {note} />
		{/if}
	</span>
	{@render marks('wide')}
	<span class="place"><Place {place} /></span>
	<span class="adp">
		{#if board !== undefined}
			<GapChip {gap} />
			<Label size="cell">{adpLabel}</Label>
		{/if}
	</span>
	<span class="ours">
		{#if board !== undefined}
			<Label>{board === null ? 'We do not rank him' : `Our rank ${String(board.rank)}`}</Label>
		{/if}
	</span>
	<button
		type="button"
		class="disclose"
		aria-expanded={open}
		aria-controls={open ? editorId : undefined}
		aria-label="Note and tags for {name}"
		onclick={ontoggle}
	>
		<Icon name="chevron" size={18} />
	</button>
	{#if open && editor}
		<div class="editor" id={editorId} data-editor>{@render editor()}</div>
	{/if}
</div>

<style>
	/* Wide: the person, then what you said about him, then the numbers: your place, where drafters
	   take him against our rank, and our rank. */
	.row {
		display: grid;
		grid-template-columns:
			32px 40px minmax(200px, 320px) minmax(0, 1fr) auto 40px 128px 104px
			36px;
		align-items: center;
		column-gap: var(--s-3);
		min-height: var(--row-h);
		padding: 4px var(--s-2) 4px var(--s-1);
		border-bottom: 1px solid var(--line);
		background: var(--bg);
		position: relative;
		cursor: pointer;
		/* A sheet is hundreds of rows. Rows off screen skip layout and paint, which keeps a drag's
		   auto-scroll inside the frame on a phone. */
		content-visibility: auto;
		/* The content box of a row never drawn yet: 52px less its padding and line. The drag
		   reads every row's height at the start, so the estimate has to match the drawn row. */
		contain-intrinsic-size: auto 43px;
	}

	.row:hover {
		background: var(--surface);
	}

	.row:active:not(:has(.editor:active)) {
		background: var(--surface-2);
	}

	.open {
		background: var(--surface);
		cursor: default;
	}

	.lifted {
		background: var(--accent-wash);
		box-shadow: var(--shadow-pop);
		z-index: 2;
	}

	/* Set by the drag controller on the row under the finger. */
	.row:global([data-dragging]) {
		background: var(--accent-wash);
		box-shadow: var(--shadow-pop);
		z-index: 3;
		cursor: grabbing;
	}

	.grip,
	.disclose {
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: var(--r-sm);
		background: transparent;
		color: var(--ink-3);
	}

	.grip {
		width: 32px;
		height: 40px;
		cursor: grab;
		touch-action: none;
	}

	.disclose {
		width: 36px;
		height: 36px;
		cursor: pointer;
	}

	.disclose :global(svg) {
		transition: transform 150ms ease-out;
	}

	.open .disclose :global(svg) {
		transform: rotate(180deg);
	}

	.grip:hover,
	.grip[aria-pressed='true'],
	.disclose:hover,
	.open .disclose {
		color: var(--ink);
		background: var(--surface-2);
	}

	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.name {
		min-width: 0;
		font-weight: 600;
		font-size: var(--t-md);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		overflow: hidden;
		font-size: var(--t-sm);
		color: var(--ink-3);
		white-space: nowrap;
		max-width: 100%;
	}

	.marks {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.wide {
		justify-content: flex-end;
	}

	.narrow,
	.narrow-gap,
	.under {
		display: none;
	}

	.said {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.glyph {
		display: inline-grid;
		place-items: center;
		color: var(--ink-3);
		flex-shrink: 0;
	}

	.place {
		text-align: right;
	}

	.adp {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 3px;
	}

	.ours {
		text-align: right;
	}

	.editor {
		grid-column: 3 / -1;
		padding: var(--s-2) 0 var(--s-3);
		cursor: default;
	}

	/* Middle widths: what you said goes back under his name. */
	@media (max-width: 1100px) {
		.row {
			grid-template-columns: 32px 40px minmax(0, 1fr) auto 40px 128px 104px 36px;
		}

		.noted {
			contain-intrinsic-size: auto 61px;
		}

		.said {
			display: none;
		}

		.under {
			display: block;
			min-width: 0;
		}
	}

	/* The phone: the person, his marks, the gap chip in his line, your place, the disclosure. The
	   handle and the disclosure are thumb-sized. */
	@media (max-width: 760px) {
		.row {
			grid-template-columns: 44px 40px minmax(0, 1fr) 24px 44px;
			column-gap: var(--s-2);
			padding: 0;
		}

		.row,
		.noted {
			contain-intrinsic-size: auto 51px;
		}

		.grip,
		.disclose {
			width: 44px;
			height: 44px;
		}

		.wide,
		.said,
		.under,
		.adp,
		.ours {
			display: none;
		}

		.narrow,
		.narrow-gap {
			display: inline-flex;
		}

		.editor {
			grid-column: 1 / -1;
			padding: var(--s-2) var(--s-2) var(--s-3);
		}
	}
</style>

<script lang="ts" module>
	/** Our board's numbers for him, the same ones the board prints. */
	export interface SheetRowBoard {
		/** Our rank on this format's board. */
		rank: number;
		/** His rank at his position on our board, the one the position pill prints everywhere. */
		positionRank: number;
		/** Where drafters take him on average, or null when he is not in our ADP window. */
		adp: number | null;
		/** The run's Gap, drafters' ADP less our rank (Lane 66q); absent on a run older than the column. */
		gap?: number | null;
		/** The word his ranks show as when he is on a season-long list ("IR", Lane 63). */
		held?: string | null;
		/** A kicker or a defense (Lane 66m): his position rank is his place in the drafters' order, and
		 * our rank only follows the ranked players, so neither is set against his ADP. */
		draftOrder?: boolean;
	}

	/** Where a kicker or a defense sits in the drafters' order, or the word for his list. */
	export function draftOrderWords(board: SheetRowBoard): string {
		if (board.held) return board.held;
		return `Draft order ${String(board.positionRank)}`;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { plural } from '#lib/format/number.ts';
	import type { Position } from '#lib/types/player.ts';
	import AdpCell from './AdpCell.svelte';
	import Face from './Face.svelte';
	import Icon from './Icon.svelte';
	import Label from './Label.svelte';
	import NoteLine from './NoteLine.svelte';
	import Place from './Place.svelte';
	import PositionPill from './PositionPill.svelte';
	import TagChip from './TagChip.svelte';
	import TierChip from './TierChip.svelte';
	import type { TagMark } from './tag.ts';
	import { SHEET } from '#lib/sheet/words.ts';

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
		/** The phone's row: his tags fold into a count beside his name, his note into a mark, and
		 * the ADP line drops its figure. The list decides it once for every row. */
		compact?: boolean;
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
		compact = false,
		open = false,
		lifted = false,
		movable = true,
		ontoggle,
		ongripkeydown,
		eager = false,
		editor
	}: Props = $props();

	const editorId = $derived(`sheet-row-${id}`);
	const avoids = $derived(tags.some((tag) => tag.tone === 'loss'));
	const tagWords = $derived(tags.map((tag) => tag.label).join(', '));

	/** A tap anywhere on the row opens it, except on its own controls and its open editor. */
	function onRowClick(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('button, a, input, textarea, label, [data-editor]')) return;
		if (window.getSelection()?.isCollapsed === false) return;
		ontoggle?.();
	}
</script>

<!-- Every part is drawn once. Wide, the parts are cells of one grid row: the person, then your
	 place, where drafters take him and our rank, then your tags and note sharing what is left.
	 On the phone, the person's two lines hold the name alone (it is never squeezed), then the
	 pill, the drafters' chip and a count of your tags.
	 data-row-id and data-grip are how the drag controller (lib/sheet/drag.ts) finds the rows and
	 their handles without a reactive update per frame. The disclosure is the control a keyboard
	 or a screen reader uses. The tap on the rest of the row is the same act for a finger.
	 Nothing in an open row changes size while you edit, so a press never lands somewhere else. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="row" class:open class:lifted class:compact data-row-id={id} onclick={onRowClick}>
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
		<span class="grip"></span>
	{/if}
	<span class="face"><Face src={headshot} size={40} loading={eager ? 'eager' : 'lazy'} /></span>
	<span class="who">
		<span class="line">
			<span class="name">{name}</span>
			{#if compact && (tags.length > 0 || note)}
				<!-- Your marks take what the name leaves. A mark that does not fit drops whole. -->
				<span class="marks">
					{#if tags.length > 0}
						<span class="count" role="img" aria-label="{plural(tags.length, 'tag')}: {tagWords}"
							><TagChip
								label={String(tags.length)}
								icon="tag"
								tone={avoids ? 'loss' : 'you'}
							/></span
						>
					{/if}
					{#if note}
						<span class="glyph" role="img" aria-label={SHEET.hasNote}
							><Icon name="note" size={14} /></span
						>
					{/if}
				</span>
			{/if}
		</span>
		<span class="meta">
			<!-- A kicker's or a defense's number is the drafters' order, never ours: it is said in words, so
			     the pill carries none ("K", not "K 1" beside "WR 2"). -->
			<PositionPill
				{position}
				rank={board?.draftOrder ? (board.held ?? undefined) : (board?.held ?? board?.positionRank)}
			/>
			{#if tier !== null}<TierChip {tier} />{/if}
			{#if team && !compact}<span class="team">{team}</span>{/if}
			{#if board?.draftOrder && compact}<span class="order-words">{draftOrderWords(board)}</span
				>{:else if board && compact}<AdpCell
					adp={board.adp}
					gap={board.gap}
					ourRank={board.rank}
					figure={false}
					compare={!board.held}
					rankWord={board.held ?? null}
				/>{/if}
		</span>
	</span>
	<span class="place"><Place {place} /></span>
	{#if !compact}
		<span class="adp">
			{#if board}<AdpCell
					adp={board.adp}
					gap={board.gap}
					ourRank={board.rank}
					compare={!board.held && !board.draftOrder}
					rankWord={board.held ?? null}
				/>{/if}
		</span>
		<span class="ours">
			{#if board !== undefined}
				<Label
					>{board === null
						? 'We do not rank him'
						: board.draftOrder
							? draftOrderWords(board)
							: `Our rank ${board.held ?? String(board.rank)}`}</Label
				>
			{/if}
		</span>
		<span class="said">
			{#each tags as tag (tag.label)}<TagChip label={tag.label} tone={tag.tone} />{/each}
			<!-- An open row's note is in its editor, so the line steps aside. -->
			{#if note && !open}
				<span class="glyph" aria-hidden="true"><Icon name="note" size={14} /></span>
				<NoteLine {note} />
			{/if}
		</span>
	{/if}
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
	.row {
		display: grid;
		grid-template-columns: 32px 40px minmax(180px, 280px) 40px 132px 112px minmax(0, 1fr) 36px;
		grid-template-areas: 'grip face who place adp ours said disclose';
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
		/* The content box of a row never drawn yet: the row's height less its padding and line.
		   The drag reads every row's height at the start, so the estimate matches the drawn row. */
		contain-intrinsic-size: auto calc(var(--row-h) - 9px);
	}

	.row:hover {
		background: var(--surface);
	}

	/* The pressed state of a tap that opens the row. An open row holds still under a press in
	   its editor. */
	.row:active {
		background: var(--surface-2);
	}

	.open,
	.open:active {
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

	.grip {
		grid-area: grip;
	}

	.face {
		grid-area: face;
		display: grid;
	}

	.who {
		grid-area: who;
	}

	.place {
		grid-area: place;
		text-align: right;
	}

	.adp {
		grid-area: adp;
	}

	.ours {
		grid-area: ours;
		text-align: right;
	}

	/* On the phone a kicker's or a defense's place, in words where a ranked row's chip sits. */
	.order-words {
		font-size: var(--t-sm);
		color: var(--ink-2);
		white-space: nowrap;
	}

	.said {
		grid-area: said;
	}

	.disclose {
		grid-area: disclose;
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

	button.grip:hover,
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

	/* The name keeps its whole width: it is cut only when it is longer than the line itself. */
	.name {
		flex-shrink: 0;
		max-width: 100%;
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
		min-width: 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
		white-space: nowrap;
		overflow: hidden;
	}

	.said {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		overflow: hidden;
	}

	.said > :global(*) {
		flex-shrink: 0;
	}

	.said > :global(.note) {
		flex-shrink: 1;
	}

	.glyph {
		display: inline-grid;
		place-items: center;
		color: var(--ink-3);
		flex-shrink: 0;
	}

	.editor {
		grid-column: 3 / -1;
		padding: var(--s-2) 0 var(--s-3);
		cursor: default;
	}

	/* Middle widths: the person's column gives up room first. */
	@media (max-width: 1100px) {
		.row {
			grid-template-columns: 32px 40px minmax(150px, 220px) 32px 124px 104px minmax(0, 1fr) 36px;
		}
	}

	/* The phone (the list sets `compact` at the same width): handle, face, the person's two lines,
	   your place, the disclosure. The handle and the disclosure are thumb-sized. The name has its
	   own line, so a tag never squeezes it. The marks come last in the second line and are the
	   part that gives way. */
	.compact {
		grid-template-columns: 44px 40px minmax(0, 1fr) 24px 44px;
		grid-template-areas: 'grip face who place disclose';
		column-gap: var(--s-2);
		padding: 0;
		/* The phone's row is the token's height with no padding, less its line. */
		contain-intrinsic-size: auto calc(var(--row-h) - 1px);
	}

	.compact .grip,
	.compact .disclose {
		width: 44px;
		height: 44px;
	}

	/* One line high: a mark that does not fit wraps out of sight whole, never cut in half. */
	.marks {
		display: inline-flex;
		flex: 1 1 0;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		min-width: 0;
		height: 20px;
		overflow: hidden;
	}

	.compact .editor {
		grid-column: 1 / -1;
		padding: var(--s-2) var(--s-2) var(--s-3);
	}
</style>

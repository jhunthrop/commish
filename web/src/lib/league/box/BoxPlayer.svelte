<script lang="ts">
	import type { Snippet } from 'svelte';
	import { links } from '#lib/site/links.ts';
	import { shelfOpener } from '#lib/player/shelf-context.ts';
	import ClubMark from '#lib/ui/ClubMark.svelte';
	import Face from '#lib/ui/Face.svelte';
	import NameWords from '#lib/ui/NameWords.svelte';
	import TagChip from '#lib/ui/TagChip.svelte';
	import { tagMarks } from '#lib/sheet/tags.ts';
	import StatusChip from '#lib/ui/StatusChip.svelte';
	import StatusPill from '#lib/ui/StatusPill.svelte';
	import PositionPill from '#lib/ui/PositionPill.svelte';
	import { pillRank } from '#lib/run/held-places.ts';
	import { HELD, tagCountWords } from '../inseason/words.ts';
	import { fitName, initialName, type BoxRow } from './box.ts';
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
		/** On a phone his name keeps one line: whole where it fits, else his short form, "J.
		 * Croskey-Merritt", as the Beats cell names him (the Lineup and the Matchup, Lane 115, B83). */
		fitOnPhone?: boolean;
		/** The trade builder's rows (Lane 66g): the game under the name at every width, without facts. */
		/** The phone's folded game line draws the expected score and weather (false on the Lineup,
		 * Waivers and Trades, whose phone basis cannot hold their sentence beside the stats sentence:
		 * a figure drawn keeps its sentence, review H2). */
		phoneFacts?: boolean;
		compact?: boolean;
		/** "Clears Wed" in the folded game, where the platform says it (Lane 66f). */
		clears?: string | null;
		/** His position chip is drawn in its own cell under the Our rank head (BoxLine rankCell, Lane 99
		 * B24): the club line keeps his status alone. */
		rankApart?: boolean;
		/** Said in place of the folded game (BoxGame's note). */
		note?: string | null;
		/** A phone's two-line row (the Rankings order and week, Lane 209): his name, pill and club on
		 * the face's line, his game as one cell with his status on the line under it, then the screen's
		 * own line (its strip of labelled cells) across the row. The screen keeps room at the line ends
		 * for its own cells with --line-end (the big figure) and --line-end-2 (the verb). */
		line?: boolean;
		/** The trade rows' tight cell (Lane 268): his club, pill, status in its short word and tags on
		 * one line, so the row keeps the Lineup's height whole, never a word cut; on a phone his name
		 * over that line and his game, two lines. */
		tight?: boolean;
		/** Drawn on the club line after the pill. */
		after?: Snippet;
		/** The screen's own line under the name, as the phone and narrow screens fold it. */
		children?: Snippet;
	}

	let {
		row,
		tags = [],
		shortOnPhone = false,
		fitOnPhone = false,
		compact = false,
		phoneFacts = true,
		clears = null,
		rankApart = false,
		note = null,
		line = false,
		tight = false,
		after,
		children
	}: Props = $props();

	/** A phone's face where the Our rank cell sits beside the name (Lane 108, B83): a little smaller,
	 * so a name keeps one line. Matches the phone rule for the club mark below. */
	const APART_PHONE_FACE = 28;
	/** A phone's two-line row draws the face at the same size, the height of its first line. */
	const LINE_PHONE_FACE = 28;
	/** The screen's player shelf (Lane 113): his name opens his card over the screen, his page
	 * stays the link's for a new tab. Undefined where no screen holds one. */
	const shelf = shelfOpener();
	/** His tags as the chips draw them: Held when the sheet's own tags are not in, else the tags. */
	/** The tight row's pill rank, as StatusPill reckons it (a season-long list's word in his rank). */
	const tightRank = $derived(
		row.pill === null
			? undefined
			: row.pill.rank === null
				? (row.status?.rank ?? undefined)
				: pillRank(row.status, row.pill.rank)
	);
	const tagLabels = $derived(
		row.held && tags.length === 0 ? [HELD] : tagMarks(tags).map((mark) => mark.label)
	);
</script>

<!-- Held is the sheet's Hold tag, said by the API: drawn when the sheet's own tags are not in. -->
{#snippet tagChips()}{#if row.held && tags.length === 0}<TagChip
			label={HELD}
		/>{/if}{#each tagMarks(tags) as mark (mark.label)}<TagChip
			label={mark.label}
			tone={mark.tone}
		/>{/each}{/snippet}

{#snippet named()}
	{#if shortOnPhone}<span class="full"><NameWords name={row.name} /></span><span class="short"
			>{initialName(row.name)}</span
		>{:else if fitOnPhone}<span class="fit"
			><span class="fit-full"><NameWords name={row.name} /></span><span
				class="fit-short"
				aria-hidden="true">{fitName(row)}</span
			></span
		>{:else}<NameWords name={row.name} />{/if}
{/snippet}

<span class="pl" class:apart={rankApart} class:line class:tight>
	{#if row.face.mark && row.face.src !== null}
		<ClubMark src={row.face.src} alt={row.face.alt} size={32} />
	{:else}
		<Face
			src={row.face.src}
			name={row.name}
			size={32}
			phoneSize={rankApart ? APART_PHONE_FACE : line ? LINE_PHONE_FACE : undefined}
		/>
	{/if}
	<span class="who" class:line class:tight>
		<span class="nm">
			{#if row.slug !== null}
				<a
					href={links.playerSeason(row.slug)}
					aria-haspopup={shelf ? 'dialog' : undefined}
					onclick={shelf ? (event) => shelf.open(event, row, note) : undefined}
					onpointerdown={shelf?.warm}
					onfocus={shelf?.warm}>{@render named()}</a
				>
			{:else}
				<b>{@render named()}</b>
			{/if}
		</span>
		<span class="club"
			><span>{row.club}</span>{#if rankApart}<span class="ppos">{row.position}</span
				>{#if row.status}<StatusChip
						status={row.status}
					/>{/if}{:else if row.pill && tight}<PositionPill
					position={row.pill.position}
					rank={tightRank}
				/>{#if row.status && row.status.short !== null}<span
						class="status-chip"
						class:sits={row.status.sits}
						><span aria-hidden="true">{row.status.short ?? row.status.mark}</span><span
							class="whole">{row.status.mark}</span
						></span
					>{/if}{:else if row.pill}<StatusPill
					position={row.pill.position}
					positionRank={row.pill.rank ?? undefined}
					status={row.status}
				/>{/if}{#if tight}{@render tagChips()}{/if}{#if after}<span class="club-after"
					>{@render after()}</span
				>{/if}</span
		>
		{#if !tight && (tags.length > 0 || row.held)}
			<span class="tags">{@render tagChips()}</span>
		{/if}
		<span class="phone-game" class:compact
			>{#if line}<span class="line-game"><BoxGame {row} facts={false} glyph {clears} {note} /></span
				>{#if row.status}<StatusChip status={row.status} />{/if}{#if after}<span class="line-after"
						>{@render after()}</span
					>{/if}{#if tagLabels.length > 0}<span
						class="line-tags"
						role="img"
						aria-label={tagLabels.join(', ')}
						title={tagLabels.join(', ')}
						><TagChip
							label={tagLabels.length === 1
								? (tagLabels[0] ?? HELD)
								: tagCountWords(tagLabels.length)}
						/></span
					>{/if}{:else}<BoxGame {row} facts={!compact && phoneFacts} {clears} {note} />{/if}</span
		>
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

	/* A long chip ("Due back Sun Oct 18", Lane 153) wraps inside itself before it widens the table. */
	.club :global(.status-chip) {
		height: auto;
		min-height: 20px;
		white-space: normal;
	}

	.short,
	.fit-short {
		display: none;
	}

	/* His position beside the club where the Our rank cell prints the rank alone, a phone's (Lane 108,
	   B83). */
	.ppos {
		display: none;
		font-weight: 700;
		color: var(--ink-2);
	}

	.phone-game {
		display: none;
	}

	/* The trade rows' tight cell (Lane 268): one club line that never wraps, its chips short. */
	.pl.tight {
		gap: 6px;
	}

	.tight .club {
		flex-wrap: nowrap;
		white-space: nowrap;
	}

	/* The whole status for a screen reader beside its short word (Lane 268). */
	.whole {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* The screen's mark after the pill, laid out as if unwrapped. */
	.club-after {
		display: contents;
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

		/* One line for the name (B83): a box one line high, a 1px float first (a zero-width one lets a
		   wider float stay beside it). The whole name floats beside it where it fits and the short
		   form, a box as wide as the rest of the line, cannot sit beside it and drops out of sight
		   below; where the whole name does not fit it drops below the first float out of sight and the
		   short form takes the line. The browser measures the words, so no width is guessed; the
		   link's name stays the whole name. */
		.nm:has(.fit) a,
		.nm:has(.fit) b {
			min-width: 0;
			max-width: 100%;
		}

		.fit {
			display: block;
			height: 1lh;
			overflow: hidden;
			white-space: nowrap;
		}

		.fit::before {
			content: '';
			float: left;
			width: 1px;
			height: 1lh;
		}

		.fit-full {
			float: left;
		}

		.fit-short {
			display: flow-root;
			min-width: calc(100% - 1px);
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.ppos {
			display: inline;
		}

		/* Beside the Our rank cell the face and its gap give the name a little room (B83). */
		.pl.apart {
			gap: 6px;
		}

		.pl.apart > :global(.mark) {
			width: 28px;
			height: 28px;
		}

		.phone-game {
			display: flex;
			flex-direction: column;
			gap: 1px;
			font-size: var(--t-xs);
			color: var(--ink-2);
		}

		/* A tight row on a phone is two lines: his name, then his club, pill, status and game. */
		.who.tight {
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			column-gap: 6px;
		}

		.who.tight .nm {
			flex-basis: 100%;
		}

		.who.tight .phone-game {
			flex-direction: row;
		}
	}

	/* A phone's two-line row (Lane 209): the face's line holds his name, pill and club and ends where
	   the screen's big figure starts; the line under it his game as one cell, his status and tags, and
	   ends at the screen's verb; the screen's own line (its strip) runs across under both. Nothing
	   wraps, so every row is one height down the list. */
	@media (max-width: 1100px) {
		.pl.line {
			align-items: flex-start;
			gap: var(--s-2);
			width: 100%;
		}

		.who.line {
			/* The pill's slot and the club code's, fixed so the column lines up (review M1). */
			--line-pill: 50px;
			--line-club: 3.2ch;
			flex: 1;
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			column-gap: 6px;
			row-gap: 2px;
		}

		.who.line .nm {
			grid-column: 1;
			grid-row: 1;
			height: 28px;
			flex-wrap: nowrap;
		}

		/* His pill and club, a column of fixed width beside the big figure, so the pills line up down
		   the list whatever the club code (review M1). */
		.who.line .club {
			grid-column: 2;
			grid-row: 1;
			flex-wrap: nowrap;
			white-space: nowrap;
			margin-right: var(--line-end, 0px);
		}

		.who.line .club > :global(.pos) {
			min-width: var(--line-pill);
			justify-content: center;
		}

		.who.line .club > span:first-child {
			order: 1;
			width: var(--line-club);
		}

		/* The pill keeps the face's line; his status, his roster mark and his tags go to the game's. */
		.who.line .club > :global(.status-chip),
		.who.line .club-after,
		.who.line .tags {
			display: none;
		}

		/* The game's line: the game, his status whole, his roster mark, his tags counted. What does not
		   fit wraps to a second game line, never cut (review M2). */
		.who.line .phone-game {
			display: flex;
			grid-column: 1 / -1;
			grid-row: 2;
			flex-direction: row;
			flex-wrap: wrap;
			align-items: center;
			column-gap: 6px;
			row-gap: 2px;
			min-height: 22px;
			min-width: 0;
			white-space: nowrap;
			margin-right: var(--line-end-2, 0px);
		}

		.line-game {
			display: flex;
			gap: 4px;
		}

		.line-after,
		.line-tags {
			display: inline-flex;
			flex: none;
		}

		/* The game's cell may break between its words before anything is cut. */
		.line-game {
			flex: 0 1 auto;
			min-width: 0;
		}

		.line-game :global(.opp) {
			flex-wrap: wrap;
			white-space: normal;
		}

		.who.line > :global(:last-child:not(.phone-game)) {
			grid-column: 1 / -1;
			grid-row: 3;
			margin-left: calc(-1 * var(--strip-pull, 0px));
		}
	}

	/* The narrowest phones: the name keeps its room, the club code gives way to the pill (his club's
	   game is on the line under it). */
	@media (max-width: 359px) {
		.who.line {
			--line-pill: 44px;
		}

		.who.line .club > span:first-child {
			display: none;
		}
	}
</style>

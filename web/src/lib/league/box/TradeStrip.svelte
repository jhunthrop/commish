<script lang="ts">
	import StripAction from '#lib/ui/StripAction.svelte';
	import type { LeagueHost } from '../api.ts';
	import type { TradeMoves } from '../inseason/api.ts';
	import { hostTab } from '../inseason/attach.ts';
	import TeamAvatar from './TeamAvatar.svelte';
	import TradeCopied from './TradeCopied.svelte';
	import {
		gainWord,
		proposeVerb,
		roomWords,
		shortSide,
		TRADES,
		weekLine,
		worthTitle,
		type CopiedTrade,
		type FinderRow
	} from './trades.ts';

	/** The Trades screen's decision as a strip (Lane 66g): the week, how many trades are worth
	 * proposing, and each as a card naming the other team, both sides, both gains over the rest of
	 * the season and the drop, with its one verb: Propose on the platform where it takes a proposal
	 * from here, else Open the platform's trades, which copies the offer and opens its page. The first
	 * card, the best trade, draws the verb solid and the rest quiet, so the strip spends one orange. */
	interface Props {
		week: number;
		rows: readonly FinderRow[];
		host: LeagueHost;
		moves: TradeMoves;
		/** The platform's trade page; empty when the API knows none, and the verb stands disabled. */
		href: string;
		/** Copies a card's offer, answering what the line under it says. */
		propose: (row: FinderRow) => Promise<CopiedTrade>;
	}

	let { week, rows, host, moves, href, propose }: Props = $props();
	const verb = $derived(proposeVerb(moves, host));
	/** What each card's verb said once pressed, by trade. */
	let said = $state<Readonly<Record<string, CopiedTrade>>>({});

	async function press(row: FinderRow): Promise<void> {
		const line = await propose(row);
		said = { ...said, [row.key]: line };
	}
</script>

<div class="strip" data-strip="trades">
	<div class="head">
		<span class="wk">{TRADES.weekWord} {week}</span>
		<span class="title">{worthTitle(rows.length)}</span>
		{#if moves.reason}<span class="why">{moves.reason}</span>{/if}
	</div>
	<ul class="cards">
		{#each rows as entry, index (entry.key)}
			{@const room = roomWords(entry.row)}
			{@const line = said[entry.key]}
			{@const week = weekLine(entry.row)}
			<li class="card">
				<span class="with"
					><TeamAvatar name={entry.team.name} size={24} />with <b>{entry.team.name}</b></span
				>
				<span class="deal"
					><b>{shortSide(entry.row.give)}</b> for <b>{shortSide(entry.row.get)}</b></span
				>
				<span class="gains"
					><em class="mine">{gainWord(entry.row.my_gain)}</em>
					{TRADES.aWeekForYou},
					<em>{gainWord(entry.row.their_gain)}</em>
					{TRADES.forThem}</span
				>
				{#if week}<span class="week">{week}</span>{/if}
				{#if entry.row.drop}<span class="drop">{room.yours}</span>{/if}
				{#if entry.row.drop_reason}<span class="drop">{entry.row.drop_reason}</span>{/if}
				<span class="act" {@attach hostTab(href)}>
					<StripAction
						lead={index === 0}
						size="sm"
						href={href === '' ? undefined : href}
						disabled={href === ''}
						onclick={() => void press(entry)}>{verb}</StripAction
					>
				</span>
				{#if line}<span class="said"><TradeCopied {line} {href} /></span>{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	.strip {
		display: grid;
		grid-template-columns: minmax(200px, 300px) minmax(0, 1fr);
		gap: var(--s-3) var(--s-5);
		align-items: center;
		min-width: 0;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.wk {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.title {
		font-family: var(--font-num);
		font-size: var(--t-head);
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
	}

	.why {
		font-size: var(--t-xs);
		line-height: 1.45;
		color: var(--ink-3);
	}

	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: var(--s-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		column-gap: var(--s-4);
		row-gap: 2px;
		align-items: center;
		padding: var(--s-3);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-md);
		background: var(--bg);
	}

	.card > span:not(.act) {
		grid-column: 1;
	}

	.act {
		grid-column: 2;
		grid-row: 1 / span 5;
	}

	.with {
		display: inline-flex;
		align-items: center;
		gap: var(--s-2);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.with b {
		color: var(--ink);
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.deal {
		font-size: var(--t-lg);
		line-height: 1.25;
	}

	.deal b {
		font-weight: 700;
	}

	.gains {
		font-size: var(--t-sm);
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	em {
		font-style: normal;
		font-family: var(--font-num);
		font-size: var(--t-lg);
		font-weight: 800;
		color: var(--ink);
	}

	em.mine {
		color: var(--gain-ink);
	}

	/* This week's Proj change for both sides, said beside the rest-of-season gains (review H2). */
	.week {
		font-size: var(--t-sm);
		color: var(--ink-2);
		font-variant-numeric: tabular-nums;
	}

	.drop {
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.said {
		grid-column: 1 / -1 !important;
		margin-top: var(--s-1);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	@media (max-width: 760px) {
		.strip {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-2);
		}

		.title {
			font-size: var(--t-xl);
		}

		.why {
			display: none;
		}

		.cards {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--s-2);
		}

		/* On a phone each card's verb takes its own line under the trade, the whole width. */
		.card {
			grid-template-columns: minmax(0, 1fr);
			padding: var(--s-2) var(--s-3);
		}

		.act {
			grid-column: 1;
			grid-row: auto;
			margin-top: var(--s-1);
		}

		.act :global(.action) {
			width: 100%;
		}

		.deal {
			font-size: var(--t-md);
		}

		.gains,
		.week,
		.drop,
		.said {
			font-size: var(--t-xs);
		}

		em {
			font-size: var(--t-md);
		}
	}
</style>

<script lang="ts">
	import { pickLabel, snakeSlot } from '#lib/format/draft.ts';
	import { plural } from '#lib/format/number.ts';
	import { callView, poolBasis } from '#lib/room/call.ts';
	import {
		type Board,
		type PoolFilter,
		draftedSet,
		poolRows,
		teamSlots,
		turnBefore,
		wallRows,
		wentSince
	} from '#lib/room/model.ts';
	import Pool from '#lib/room/Pool.svelte';
	import RoomCall from '#lib/room/RoomCall.svelte';
	import RoomLayout from '#lib/room/RoomLayout.svelte';
	import Wall from '#lib/room/Wall.svelte';
	import { leagueLine } from '#lib/room/words.ts';
	import Panel from '#lib/ui/Panel.svelte';
	import PickStrip from '#lib/ui/PickStrip.svelte';
	import SinceStrip from '#lib/ui/SinceStrip.svelte';
	import TeamPanel from '#lib/ui/TeamPanel.svelte';
	import type { Companion, CompanionPick, Feature } from './api.ts';
	import CompanionBar from './CompanionBar.svelte';
	import { has, hostDraftUrl, hostName, landingStrip, roomPicks, seatNames } from './model.ts';
	import SheetSync from './SheetSync.svelte';
	import Shortlist from './Shortlist.svelte';

	/** A draft on Sleeper followed from your seat: the host's pick count, the picks as they land, at
	 * your turn our call with both chances and who we would take next, the pool with each player's
	 * chance of lasting, your team, and with synced_sheet your sheet struck as players go. */
	interface Props {
		companion: Companion;
		picks: readonly CompanionPick[];
		board: Board;
		features: readonly Feature[];
		search: string;
	}

	let { companion: c, picks, board, features, search }: Props = $props();

	const host = $derived(hostName(c.host));

	const FILTERS: readonly PoolFilter[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
	let filter = $state<PoolFilter>('All');

	const teams = $derived(c.teams);
	const placed = $derived(roomPicks(picks));
	const drafted = $derived(draftedSet(placed));
	const mine = $derived(placed.filter((p) => p.seat === c.slot));
	const now = $derived(c.pick_count + 1);
	const round = $derived(snakeSlot(Math.min(now, c.total_picks), teams).round);
	const prev = $derived(turnBefore(now, c.slot, teams));
	const card = $derived(c.card);
	/** At your turn our call; between turns the lobby's conditional call, the player to take if the
	 * board holds to your next pick. */
	const call = $derived(
		card && (c.your_turn || card.conditional) ? callView(card, board, drafted, teams) : null
	);
	const onTurn = $derived(call !== null && c.your_turn);
	const chanceLabel = $derived(
		card?.conditional
			? `reaches ${pickLabel(card.for_pick, teams)}`
			: card?.next_pick
				? `still there at ${pickLabel(card.next_pick, teams)}`
				: 'your last pick'
	);
	const rows = $derived(poolRows(board, drafted, filter, [], search));
	const names = $derived(seatNames(c));
	const strip = $derived(landingStrip(picks, board, teams, c.slot, names));
	const went = $derived(wentSince(placed, prev ?? 0, new Set(), board));
	/** How many name-matched picks the drafter has already been told of: on his turn only the new
	 * ones show, between turns all of them, and never more than two lines. */
	let namedSeen = $state(0);
	$effect(() => {
		if (!c.your_turn) namedSeen = c.placed_by_name.length;
	});
	const namedShown = $derived(c.your_turn ? c.placed_by_name.slice(namedSeen) : c.placed_by_name);
	const NAMED_LINES = 2;
	const notes = $derived(
		[
			c.unplaced > 0
				? `${plural(c.unplaced, 'pick')} on ${host} ${c.unplaced === 1 ? 'is a player' : 'are players'} we do not rank. Each fills his team's roster and takes nobody from our board.`
				: null,
			...namedShown.slice(0, NAMED_LINES).map(
				(p) =>
					// A name that ends in "Jr." ends the sentence too.
					`${p.host_name} on ${host} is our ${p.board_name}${p.board_name.endsWith('.') ? '' : '.'}`
			),
			namedShown.length > NAMED_LINES
				? `And ${String(namedShown.length - NAMED_LINES)} more placed by name.`
				: null,
			c.traded > 0
				? `${plural(c.traded, 'pick')} changed hands on ${host}. Our call follows the draft order by slot.`
				: null
		].filter((n): n is string => n !== null)
	);

	const SLEEPER_TAB = 'sleeper-draft';

	/** The Sleeper tab this page opened, kept so every later turn returns to it. */
	let sleeperTab: Window | null = null;

	/**
	 * One Sleeper tab for the whole draft. The first turn opens it by name and cuts its opener while
	 * it is still about:blank (same origin), so Sleeper can never navigate this page. Every later turn
	 * brings that same tab forward: it is already the draft room, and with its opener cut this page
	 * may focus it but not navigate it (Chromium refuses with a SecurityError, measured). If the
	 * drafter closed it, the next turn opens a new one. A tab left from before a reload is found by
	 * its name, and cutting its opener then may be refused, which changes nothing the drafter sees.
	 */
	function openHost(): void {
		if (sleeperTab && !sleeperTab.closed) {
			sleeperTab.focus();
			return;
		}
		sleeperTab = window.open(hostDraftUrl(c), SLEEPER_TAB);
		try {
			if (sleeperTab) sleeperTab.opener = null;
		} catch {
			// Already on sleeper.com (a tab from before a reload): its opener is out of reach.
		}
	}
</script>

<RoomLayout>
	<CompanionBar companion={c} league={leagueLine(c.settings, c.slot)} />
	{#if c.lost_at !== null}
		<Panel edge="loss" padding="sm">
			<p class="note">
				Pick {pickLabel(c.lost_at, teams)} on {host} does not fit how our draft is set up, so our call
				stops there. The picks keep landing below.
			</p>
		</Panel>
	{/if}
	{#each notes as note (note)}
		<p class="note">{note}</p>
	{/each}
	{#if strip.length > 0 && !onTurn}
		<PickStrip
			lead={pickLabel(picks.at(-1)?.pick ?? 1, teams)}
			leadLines={[`just taken on ${host}`, 'newest first']}
			picks={strip}
			width="md"
		/>
	{/if}
	{#if call && card && onTurn}
		{#if went.length > 0}<SinceStrip since={prev} {went} {teams} queue={false} />{/if}
		<RoomCall
			view={call}
			pickNumber={now}
			action={{ label: `Make the pick on ${host}`, onclick: openHost }}
		/>
		<Shortlist {card} {board} {chanceLabel} ranges={c.ranges} />
	{:else if call}
		<RoomCall
			view={call}
			pickNumber={now}
			action={{ label: `Queue him on ${host}`, onclick: openHost }}
		/>
	{/if}
	{#if c.status !== 'complete'}
		<Pool
			{rows}
			left={board.players.length - drafted.size}
			chance={card?.still_there ?? {}}
			{chanceLabel}
			chanceHead={card?.conditional ? 'Reaches' : 'Still there'}
			chanceShown={call !== null}
			basis={call ? poolBasis(board, card, teams) : c.basis}
			pickNumber={now}
			callId={call?.player.id ?? null}
			selectedId={call?.player.id ?? null}
			queue={new Set()}
			draftShown={false}
			canDraft={false}
			readonly
			{filter}
			filters={FILTERS}
			{search}
			onfilter={(f: PoolFilter) => (filter = f)}
			ondraft={() => undefined}
			onqueue={() => undefined}
			onselect={() => undefined}
		/>
	{/if}
	<Wall
		rows={wallRows(placed, board, teams, Math.min(c.rounds, round))}
		{names}
		you={c.slot}
		now={c.status === 'complete' ? null : now}
		{teams}
		rounds={c.rounds}
	/>
	{#snippet dock()}
		<TeamPanel slots={teamSlots(c.settings, mine, board)} rosterSize={c.rounds} {teams} />
		{#if has(features, 'synced_sheet')}
			<SheetSync taken={drafted} />
		{/if}
	{/snippet}
</RoomLayout>

<style>
	.note {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}
</style>

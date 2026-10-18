<script lang="ts">
	import StatusChip from '#lib/ui/StatusChip.svelte';
	import { onMount } from 'svelte';
	import ClubMark from '#lib/ui/ClubMark.svelte';
	import Face from '#lib/ui/Face.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import BugCard from '#lib/league/box/BugCard.svelte';
	import MoveMark from '#lib/league/box/MoveMark.svelte';
	import PinnedVerb from '#lib/league/box/PinnedVerb.svelte';
	import type { BoxRow } from '#lib/league/box/box.ts';
	import { tabHref } from '#lib/league/inseason/tabs.ts';
	import { weekApi } from './api.ts';
	import {
		FRONT,
		frontLeague,
		leadOf,
		readWords,
		rosterAside,
		weekBasis,
		type FrontLeague,
		type MemberWeek,
		type ScreenHref
	} from './week.ts';

	/** The front door in season for a member with a league (Lane 66k): the chosen league's score bug,
	 * its lineup's changes as the one verb, its three roster facts as chips that open the screen that
	 * acts on each, then every other league's bug. One read, GET /me/week; the page reads nothing else
	 * of the season. A read that fails says so, with the way to read again. */
	interface Props {
		/** The league the shell has chosen, null for none. */
		chosen: string | null;
	}

	let { chosen }: Props = $props();

	const href: ScreenHref = (screen, id) => tabHref(screen, id);
	let week = $state<MemberWeek | null>(null);
	let failed = $state(false);

	async function read(): Promise<void> {
		failed = false;
		try {
			week = await weekApi.week();
		} catch {
			failed = true;
		}
	}

	onMount(() => void read());

	const now = new Date();
	const lead = $derived(week ? leadOf(week.leagues, chosen) : null);
	const view = $derived(lead ? frontLeague(lead, href, now) : null);
	const others = $derived(
		week && lead
			? week.leagues.filter((l) => l.id !== lead.id).map((l) => frontLeague(l, href, now))
			: []
	);
	const read_ = $derived(lead ? readWords(lead, now) : null);
	const basis = $derived(lead && view?.bug ? weekBasis(lead, others.length > 0) : []);
</script>

{#snippet face(row: BoxRow, size: number)}
	{#if row.face.mark && row.face.src !== null}
		<ClubMark src={row.face.src} alt={row.face.alt} {size} />
	{:else}
		<Face src={row.face.src} name={row.name} {size} />
	{/if}
{/snippet}

{#snippet quietLeague(l: FrontLeague)}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tabHref builds it with resolve(). -->
	<a class="lgr" href={l.leagueHref}>
		<span class="txt"
			><b>{l.name}</b><span>{[l.line, `on ${l.platform}`].filter((p) => p !== '').join(', ')}</span
			></span
		>
		<span class="said">{l.problem ?? l.phase ?? ''}</span>
	</a>
{/snippet}

<section class="front-week" aria-label="Your week" aria-busy={week === null && !failed}>
	{#if failed}
		<div class="unread" role="status">
			<span>{FRONT.unread}</span>
			<Quiet size="sm" onclick={() => void read()}>{FRONT.tryAgain}</Quiet>
		</div>
	{:else if week === null}
		<div class="reserve" aria-hidden="true"></div>
	{:else if view}
		<div class="title">
			<h2>{view.name}</h2>
			<p class="lede">
				{[view.line, read_].filter((p) => p !== null && p !== '').join('. ')}
			</p>
		</div>

		{#if view.bug && view.nudge}
			<div class="band">
				<BugCard bug={view.bug} href={view.matchupHref} size="lg">
					{#snippet foot()}
						{#if view.first}
							{#each view.first.rows.slice(0, 1) as row (row.key)}{@render face(row, 24)}{/each}
							<span class="first">{view.first.words}</span>
						{/if}
						<span class="open">{FRONT.matchup}</span>
					{/snippet}
				</BugCard>
				<section class="nudge" aria-label="Your lineup">
					<div class="n-top">
						<div class="n-head">
							<span class="wk">Week {view.nudge.week}</span><b>{view.nudge.title}</b>
						</div>
						{#if view.nudge.sum}
							<div class="n-sum">
								{#if view.nudge.sum.gain}<b>{view.nudge.sum.gain}</b>{:else}<b
										>{view.nudge.sum.figure}</b
									>{/if}
								<span
									>{view.nudge.sum.gain ? `${view.nudge.sum.figure} ` : ''}{view.nudge.sum
										.words}</span
								>
							</div>
						{/if}
					</div>
					{#if view.nudge.swaps.length > 0}
						<ul class="swaps">
							{#each view.nudge.swaps as swap (swap.key)}
								<li>
									<span class="slot">{swap.slot}</span>
									<span class="in"><MoveMark move="in" size={14} />{swap.in}</span>
									{#if swap.out}<span class="out"><MoveMark move="out" size={14} />{swap.out}</span
										>{/if}
								</li>
							{/each}
						</ul>
					{/if}
					<div class="n-act">
						<span class="as-set">{view.nudge.asSet}</span>
						{#if view.nudge.solid}
							<PinnedVerb><Verb href={view.nudge.href}>{view.nudge.verb}</Verb></PinnedVerb>
						{:else}
							<Quiet href={view.nudge.href} size="sm">{view.nudge.verb}</Quiet>
						{/if}
					</div>
				</section>
			</div>
		{:else}
			<div class="lgs">{@render quietLeague(view)}</div>
		{/if}

		{#if view.chips.length > 0}
			<section aria-label={FRONT.yourRoster}>
				<div class="sec-h">
					<h3>{FRONT.yourRoster}</h3>
					<span>{rosterAside(view.chips.length)}</span>
				</div>
				<ul class="chips">
					{#each view.chips as chip (chip.key)}
						<li>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tabHref builds it with resolve(). -->
							<a class="chip" href={chip.href}>
								{@render face(chip.row, 38)}
								<span class="txt"><b>{chip.row.name}</b><span>{chip.line}</span></span>
								{#if chip.kind === 'status' && chip.row.status}<StatusChip
										status={chip.row.status}
									/>{:else}<span class="kind {chip.kind}">{chip.label}</span>{/if}
								<span class="go">{chip.go}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if others.length > 0}
			<section aria-label={FRONT.otherLeagues}>
				<div class="sec-h">
					<h3>{FRONT.otherLeagues}</h3>
					<span>{FRONT.otherAside}</span>
				</div>
				<ul class="others">
					{#each others as l (l.id)}
						<li>
							{#if l.bug}
								<BugCard bug={l.bug} href={l.leagueHref} label="{l.name}, {l.platform}">
									{#snippet foot()}<span class="changes">{l.changes ?? ''}</span>{/snippet}
								</BugCard>
							{:else}
								<div class="lgs">{@render quietLeague(l)}</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if basis.length > 0}
			<div class="basis">
				{#each basis as said (said)}<p>{said}</p>{/each}
			</div>
		{/if}
	{/if}
</section>

<style>
	.front-week {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		min-width: 0;
	}

	.reserve {
		min-height: 300px;
	}

	.unread {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	.title h2 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-display);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
		max-width: 28ch;
	}

	.lede {
		margin: 6px 0 0;
		font-size: var(--t-sm);
		color: var(--ink-3);
	}

	.band {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
		gap: var(--s-3);
		align-items: stretch;
	}

	.first {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.open {
		margin-left: auto;
		color: var(--scoreboard-ink);
		font-weight: 600;
		white-space: nowrap;
	}

	.nudge {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
		padding: var(--s-3) var(--s-4);
		border: 1px solid var(--line);
		border-left: 4px solid var(--accent);
		border-radius: var(--r-md);
		background: var(--surface);
		min-width: 0;
	}

	.n-top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--s-3);
	}

	.n-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.wk {
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		color: var(--accent-text);
	}

	.n-head b {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
		white-space: nowrap;
	}

	.n-sum {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}

	.n-sum b {
		font-family: var(--font-num);
		font-size: var(--t-xl);
		font-weight: 800;
		line-height: 1;
		color: var(--accent-text);
		font-variant-numeric: tabular-nums;
	}

	.n-sum span {
		font-size: var(--t-xs);
		color: var(--ink-3);
		font-variant-numeric: tabular-nums;
	}

	.swaps {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.swaps li {
		display: flex;
		align-items: center;
		gap: var(--s-2);
		height: 34px;
		padding: 0 var(--s-3) 0 4px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--bg);
		font-size: var(--t-sm);
		white-space: nowrap;
	}

	.slot {
		display: grid;
		place-items: center;
		height: 26px;
		min-width: 40px;
		padding: 0 6px;
		border-radius: var(--r-pill);
		background: var(--surface-2);
		font-family: var(--font-num);
		font-weight: 700;
		font-size: var(--t-sm);
		letter-spacing: 0.03em;
	}

	.in,
	.out {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	.in {
		font-weight: 700;
	}

	.out {
		color: var(--ink-3);
	}

	.n-act {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-3);
		margin-top: auto;
	}

	.as-set {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.sec-h {
		display: flex;
		align-items: baseline;
		gap: var(--s-3);
		margin: 0 0 var(--s-2);
	}

	.sec-h h3 {
		margin: 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: var(--t-xl);
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.02em;
		white-space: nowrap;
	}

	.sec-h span {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.chips,
	.others {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--s-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chip,
	.lgr {
		display: flex;
		align-items: center;
		gap: var(--s-3);
		min-height: 58px;
		height: 100%;
		padding: var(--s-2) var(--s-3);
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--ink);
		text-decoration: none;
	}

	.chip:hover,
	.lgr:hover {
		border-color: var(--line-strong);
		background: var(--surface-2);
	}

	.txt {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.txt b {
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.txt span {
		font-size: var(--t-xs);
		color: var(--ink-3);
		line-height: 1.35;
	}

	.kind {
		display: inline-flex;
		align-items: center;
		height: 22px;
		padding: 0 8px;
		border-radius: var(--r-sm);
		font-size: var(--t-xs);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: var(--track-label);
		white-space: nowrap;
	}

	.kind.bye {
		border: 1px solid var(--line-strong);
		color: var(--ink-2);
	}

	.kind.pickup {
		background: var(--gain-bg);
		color: var(--gain-ink);
	}

	.go {
		font-size: var(--t-sm);
		font-weight: 600;
		color: var(--ink-2);
		white-space: nowrap;
	}

	.changes {
		color: var(--scoreboard-ink);
		font-weight: 600;
	}

	.said {
		font-size: var(--t-xs);
		color: var(--ink-2);
		text-align: right;
		max-width: 50%;
	}

	.basis {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-width: 1000px;
	}

	.basis p {
		margin: 0;
		font-size: var(--t-sm);
		color: var(--ink-2);
	}

	@media (max-width: 1100px) {
		.others {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 900px) {
		.band,
		.chips {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (max-width: 760px) {
		.others {
			grid-template-columns: minmax(0, 1fr);
		}

		.nudge {
			padding: var(--s-3);
		}

		.as-set {
			display: none;
		}

		.basis p {
			font-size: var(--t-xs);
		}
	}
</style>

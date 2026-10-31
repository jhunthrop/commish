<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { hasSessionCookie } from '#lib/api/session.ts';
	import { isSignedOut } from '#lib/api/status.ts';
	import { LEAGUE_HOST_PARAM, MEMBER_WAYS, links, type MemberWay } from '#lib/site/links.ts';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import EmptyState from '#lib/ui/EmptyState.svelte';
	import Field from '#lib/ui/Field.svelte';
	import LineList from '#lib/ui/LineList.svelte';
	import PanelHead from '#lib/ui/PanelHead.svelte';
	import ProblemLine from '#lib/ui/ProblemLine.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import { hasFeature } from '#lib/account/features.ts';
	import FFPCLeagues from '#lib/hosts/FFPCLeagues.svelte';
	import MemberLeagues from '#lib/hosts/MemberLeagues.svelte';
	import {
		ffpcOpen,
		hostsApi,
		espnOpen,
		needsSignIn,
		yahooOpen,
		type HostLeague,
		type PickAnswer
	} from '#lib/hosts/api.ts';
	import { ApiError, leagueApi, type AttachPreview, type AttachedLeague } from './api.ts';
	import {
		followInOrder,
		followVerb,
		followingWords,
		missedWords,
		roomToFollow
	} from './follow-many.ts';
	import {
		IN_SEASON_TOOLS_LINE,
		followedLine,
		followedName,
		hostWords,
		hostsLine
	} from './model.ts';
	import NotAffiliated from './NotAffiliated.svelte';
	import { FLAGS } from '#lib/site/flags.ts';
	import { FOLLOW_FOR } from './phase-words.ts';
	import { LEAGUE_HOME, SCREEN_PARAM } from '#lib/ui/nav.ts';
	import { leagueScreenOf, screenSection } from '#lib/ui/rail-league.ts';

	/** Attach a league: paste its link, say which team is yours (a tap on it, or a Sleeper username),
	 * one verb. The league is read as soon as the link is pasted, so the teams are there to tap. */

	/** How long the page waits after typing stops before it reads the link. */
	const READ_AFTER_MS = 400;

	type View = 'loading' | 'signed-out' | 'form' | 'unreachable';

	/** The league screen a rail item led here from (`?screen=start`): its line names it, and its item
	 * stays lit. Derived from the address, so a second rail tap on this page changes both. */
	const forScreen = $derived(leagueScreenOf(page.url.searchParams.get(SCREEN_PARAM)));

	let view = $state<View>('loading');
	/** How the league comes in: a pasted link (Sleeper, MyFantasyLeague, a public ESPN league), or a
	 * host read as you (FFPC, Yahoo, ESPN). A `?host=ffpc` starts on FFPC, and rides the sign-in's return path with the rest of the
	 * search. */
	let way = $state<'link' | MemberWay>(startWay(page.url.searchParams.get(LEAGUE_HOST_PARAM)));
	/** FFPC, Yahoo and ESPN are offered only where each is open (HOST_FFPC_ENABLED,
	 * HOST_YAHOO_ENABLED, HOST_ESPN_ENABLED). */
	let ffpcOn = $state(false);
	let yahooOn = $state(false);
	let espnOn = $state(false);

	function startWay(asked: string | null): 'link' | MemberWay {
		return MEMBER_WAYS.find((w) => w === asked) ?? 'link';
	}
	let link = $state('');
	let preview = $state<AttachPreview | null>(null);
	let reading = $state(false);
	let by = $state<'team' | 'username'>('team');
	let rosterId = $state<number | null>(null);
	let username = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);
	let attached = $state<AttachedLeague[]>([]);
	let timer: ReturnType<typeof setTimeout> | null = null;
	/** The link a preview was asked for, so a late answer for an older link is dropped. */
	let asked = '';

	onMount(() => {
		hostsApi
			.connections()
			.then((hosts) => {
				ffpcOn = ffpcOpen(hosts);
				yahooOn = yahooOpen(hosts);
				espnOn = espnOpen(hosts);
			})
			.catch(() => {
				ffpcOn = false;
				yahooOn = false;
				espnOn = false;
			});
		// With no session the answer is a 401: the page is the signed-out one without asking.
		if (!hasSessionCookie()) view = 'signed-out';
		else
			leagueApi
				.attached()
				.then((list) => {
					attached = list;
					view = 'form';
					const pasted = page.url.searchParams.get('link');
					if (pasted) typed(pasted);
				})
				.catch((error: unknown) => (view = isSignedOut(error) ? 'signed-out' : 'unreachable'));
		return () => {
			if (timer !== null) clearTimeout(timer);
		};
	});

	function failure(error: unknown): string {
		const fields = error instanceof ApiError ? Object.values(error.fields) : [];
		return (
			fields[0] ??
			(error instanceof ApiError ? error.message : 'That did not go through. Try again.')
		);
	}

	function typed(value: string): void {
		link = value;
		preview = null;
		rosterId = null;
		problem = null;
		if (timer !== null) clearTimeout(timer);
		if (value.trim() === '') return;
		timer = setTimeout(() => void read(value.trim()), READ_AFTER_MS);
	}

	async function read(value: string): Promise<void> {
		asked = value;
		reading = true;
		try {
			const answer = await leagueApi.preview(value);
			if (asked !== value) return;
			preview = answer;
			if (!answer.seat_by_username) by = 'team';
		} catch (error) {
			if (asked === value) problem = failure(error);
		} finally {
			if (asked === value) reading = false;
		}
	}

	const ready = $derived(
		preview !== null &&
			(by === 'team' ? rosterId !== null : username.trim() !== '') &&
			!busy &&
			!reading
	);

	async function follow(): Promise<void> {
		if (!ready || preview === null) return;
		busy = true;
		problem = null;
		try {
			const me = by === 'team' ? { roster_id: rosterId } : { username: username.trim() };
			const made = await leagueApi.attach({ host: preview.host, link: link.trim(), me });
			void siteContext.refresh();
			await goto(resolve('/league/[id]', { id: made.id }));
		} catch (error) {
			problem = failure(error);
			busy = false;
		}
	}

	/** What the reader may use, from the rail's one read of /me (Can). */
	const many = $derived(hasFeature(siteContext.features, 'many_leagues'));
	/** How many more leagues this account can follow now. */
	const room = $derived(roomToFollow(many, attached.length));
	/** The leagues already followed on a member host, by the host's league id, to their page here. */
	function followedOn(host: MemberWay): Map<string, string> {
		return new Map(
			attached.filter((a) => a.host === host).map((a) => [a.host_league_id, links.league(a.id)])
		);
	}

	async function reread(): Promise<void> {
		attached = await leagueApi.attached();
		void siteContext.refresh();
	}

	/** Each chosen league on a member host through the one attach, in order. All followed: one league
	 * opens its page, more open the account's list with the summary. A miss stays here, named. */
	async function followOn(host: MemberWay, leagues: HostLeague[]): Promise<PickAnswer | null> {
		const outcome = await followInOrder(
			leagues.map((l) => ({ key: l.league_id, name: l.name })),
			async (l) => (await leagueApi.attach({ host, link: l.key, me: {} })).id,
			failure,
			needsSignIn
		).finally(() => void reread().catch(() => undefined));
		const [first] = outcome.made;
		if (outcome.missed.length === 0 && first) {
			const count = outcome.made.length;
			await goto(count === 1 ? links.league(first.id) : links.accountLeagues(count));
			return null;
		}
		return {
			status: outcome.made.length > 0 ? followingWords(outcome.made.length) : '',
			problems: outcome.missed.map(missedWords)
		};
	}

	const attachedLines = $derived(
		attached.map((a) => ({
			key: a.id,
			lead: followedName(a),
			text: followedLine(a),
			href: links.league(a.id)
		}))
	);
</script>

<svelte:head>
	<title>Follow your league · Commish</title>
</svelte:head>

<Shell title="League" active={screenSection(forScreen ?? LEAGUE_HOME)}>
	<main class="new">
		{#if view === 'loading'}
			<div class="reserve"></div>
		{:else if view === 'signed-out'}
			<DisplayTitle size="page">Follow your league</DisplayTitle>
			{@render gives(false)}
			<ActionBar>
				<!-- Back from sign-in on this same address, so a shared ?link= is still in it. -->
				<Verb href={leagueApi.signInUrl(page.url.pathname + page.url.search)}
					>Sign in to follow it</Verb
				>
			</ActionBar>
		{:else if view === 'unreachable'}
			<EmptyState title="This page can't reach Commish right now" line="Reload in a moment." />
		{:else}
			<DisplayTitle size="page">Follow your league</DisplayTitle>
			{@render gives(way === 'link')}
			{#if ffpcOn || yahooOn || espnOn}
				<ChipGroup label="Your league is on" fit>
					<Chip pressed={way === 'link'} onclick={() => (way = 'link')}
						>Sleeper or MyFantasyLeague</Chip
					>
					{#if ffpcOn}
						<Chip pressed={way === 'ffpc'} onclick={() => (way = 'ffpc')}>FFPC</Chip>
					{/if}
					{#if yahooOn}
						<Chip pressed={way === 'yahoo'} onclick={() => (way = 'yahoo')}>Yahoo</Chip>
					{/if}
					{#if espnOn}
						<Chip pressed={way === 'espn'} onclick={() => (way = 'espn')}>ESPN</Chip>
					{/if}
				</ChipGroup>
			{/if}
			{#if ffpcOn && way === 'ffpc'}
				<FFPCLeagues
					verb={(count: number) => followVerb(count, room)}
					onpick={(leagues: HostLeague[]) => followOn('ffpc', leagues)}
					most={room}
					followed={followedOn('ffpc')}
				/>
			{:else if (yahooOn && way === 'yahoo') || (espnOn && way === 'espn')}
				{@const host = way === 'yahoo' ? 'yahoo' : 'espn'}
				{#key host}
					<MemberLeagues
						{host}
						verb={(count: number) => followVerb(count, room)}
						onpick={(leagues: HostLeague[]) => followOn(host, leagues)}
						most={room}
						followed={followedOn(host)}
					/>
				{/key}
			{:else}
				<div class="form">
					<Field
						label="Your league's link"
						value={link}
						oninput={typed}
						placeholder="sleeper.com/leagues/1234567890"
						maxlength={300}
						onenter={() => void follow()}
					/>
					{#if reading}
						<p class="lede" role="status">Reading your league.</p>
					{:else if preview}
						<div class="seat">
							<PanelHead
								title={preview.name || `Your ${hostWords(preview.host)} league`}
								aside={`${String(preview.teams.length)} teams on ${hostWords(preview.host)}`}
								level={2}
							/>
							{#if preview.seat_by_username}
								<ChipGroup label="Find your team by">
									<Chip pressed={by === 'team'} onclick={() => (by = 'team')}>From the list</Chip>
									<Chip pressed={by === 'username'} onclick={() => (by = 'username')}
										>My Sleeper username</Chip
									>
								</ChipGroup>
							{/if}
							{#if by === 'team'}
								<ChipGroup label="Your team" variant="loose">
									{#each preview.teams as team (team.roster_id)}
										<Chip
											pressed={rosterId === team.roster_id}
											onclick={() => (rosterId = team.roster_id)}
											label={team.owner ? `${team.name}, ${team.owner}` : team.name}
											>{team.name}</Chip
										>
									{/each}
								</ChipGroup>
							{:else}
								<Field
									label="Sleeper username"
									bind:value={username}
									maxlength={40}
									onenter={() => void follow()}
								/>
							{/if}
						</div>
					{/if}
				</div>
				<ActionBar alert={problem ? alert : undefined}>
					<Verb disabled={!ready} onclick={() => void follow()}>Follow my league</Verb>
				</ActionBar>
			{/if}
			{#if attached.length > 0}
				<section aria-label="Leagues you follow">
					<PanelHead title="Leagues you follow" level={2} />
					<LineList label="Leagues you follow" lines={attachedLines} />
				</section>
			{/if}
		{/if}
	</main>
</Shell>

<!-- What following a league gives, and where from: the same two lines signed in and out. Only the
     link form, which has the field, asks for the link. -->
{#snippet gives(withField: boolean)}
	{#if forScreen}<p class="for">{FOLLOW_FOR[forScreen]}</p>{/if}
	<p class="lede">
		{#if withField}Paste your league's link.{/if}
		We keep your roster, this week's matchup and your league's free agents up to date, on our board. Free.
		{#if FLAGS.in_season_tools}{IN_SEASON_TOOLS_LINE}{/if}
	</p>
	<p class="hosts">{hostsLine({ ffpc: ffpcOn, yahoo: yahooOn, espn: espnOn })}</p>
	<NotAffiliated />
{/snippet}

{#snippet alert()}
	<ProblemLine>{problem}</ProblemLine>
{/snippet}

<style>
	.new {
		display: flex;
		flex-direction: column;
		gap: var(--s-4);
		padding: var(--s-5);
		max-width: 760px;
	}

	.for {
		margin: 0;
		font-weight: 600;
	}

	.lede,
	.hosts {
		margin: 0;
		color: var(--ink-2);
		max-width: 60ch;
	}

	.hosts {
		font-size: var(--t-sm);
	}

	.form,
	.seat {
		display: flex;
		flex-direction: column;
		gap: var(--s-3);
	}

	.reserve {
		min-height: 60vh;
	}

	@media (max-width: 760px) {
		.new {
			padding: var(--s-4);
		}
	}
</style>

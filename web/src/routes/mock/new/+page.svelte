<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import ActionBar from '#lib/ui/ActionBar.svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import DisplayTitle from '#lib/ui/DisplayTitle.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { startMock } from '#lib/room/actions.ts';
	import { siteContext } from '#lib/context/context.svelte.ts';
	import {
		ApiError,
		isSignedOut,
		signInHref,
		type BoardPlayer,
		type League,
		type LeagueSettings,
		type LobbyFilling,
		type LobbyFormat,
		rooms
	} from '#lib/room/api.ts';
	import RoomLayout from '#lib/room/RoomLayout.svelte';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import RosterRow from '#lib/room/setup/RosterRow.svelte';
	import SaveLeague from '#lib/room/setup/SaveLeague.svelte';
	import ScoringRow from '#lib/room/setup/ScoringRow.svelte';
	import SetupRow from '#lib/room/setup/SetupRow.svelte';
	import HandlePrompt from '#lib/room/setup/HandlePrompt.svelte';
	import KeeperEditor from '#lib/room/setup/KeeperEditor.svelte';
	import LeftLobby from '#lib/room/setup/LeftLobby.svelte';
	import { forgetLeft, leftLobby } from '#lib/room/setup/left.ts';
	import LobbyList from '#lib/room/setup/LobbyList.svelte';
	import SavedLeagues from '#lib/room/setup/SavedLeagues.svelte';
	import { rerunOf } from '#lib/room/setup/scoring.ts';
	import { hasFeature } from '#lib/account/features.ts';
	import {
		LINEUP_CHOICES,
		MAX_ROUNDS,
		MIN_ROUNDS,
		TEAM_CHOICES,
		defaultSettings,
		inFormat,
		nearestLobby,
		roundsOf,
		setupCells
	} from '#lib/room/setup/setup.ts';
	import FactStrip from '#lib/ui/FactStrip.svelte';

	/** How often the lobbies' fill is read while the page is open. */
	const LOBBY_POLL_MS = 5000;

	let settings = $state<LeagueSettings>(defaultSettings());
	let leagues = $state<League[]>([]);
	/** The account drafts a saved league's own scoring rules; without them, the nearest preset. */
	let exactRules = $state(false);
	let lobbies = $state<LobbyFilling[]>([]);
	let players = $state<BoardPlayer[]>([]);
	let keepersOpen = $state(false);
	let busy = $state(false);
	let error = $state<unknown>(null);
	let handleFor = $state<LobbyFormat | null>(null);
	let handleProblem = $state<string | null>(null);
	/** Signed out, a mock against bots still runs, kept with this browser until sign-in claims it. */
	let signedOut = $state(false);
	/** The lobby Leave came from, offered back in the dock. */
	let left = $state<string | null>(null);
	/** The saved league the page opened on (`?league=`, the league page's Start a mock draft): while
	 * the form holds its settings, a draft slot aside, the verb drafts that league. Any other change
	 * to the form lets it go. */
	let opened = $state<League | null>(null);

	const rounds = $derived(roundsOf(settings));
	const roundsOk = $derived(rounds >= MIN_ROUNDS && rounds <= MAX_ROUNDS);
	const boardFormat = $derived(
		settings.scoring.preset === 'half_ppr'
			? 'half'
			: settings.scoring.preset === 'standard'
				? 'std'
				: 'ppr'
	);

	function set(patch: Partial<LeagueSettings>): void {
		settings = { ...settings, ...patch };
		// Choosing a slot is part of drafting the league, every other change makes a new setup.
		if (Object.keys(patch).some((key) => key !== 'slot')) opened = null;
	}

	function setTeams(teams: number): void {
		const slot = settings.slot !== null && settings.slot > teams ? null : settings.slot;
		set({ teams, slot, keepers: settings.keepers.filter((k) => k.slot <= teams) });
	}

	async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
		if (busy) return undefined;
		busy = true;
		error = null;
		try {
			return await work();
		} catch (e) {
			error = e;
			return undefined;
		} finally {
			busy = false;
		}
	}

	async function join(format: LobbyFormat): Promise<void> {
		await run(async () => {
			try {
				const seat = await rooms.join(format);
				await goto(resolve('/lobby/[id]', { id: seat.room_id }));
			} catch (e) {
				if (e instanceof ApiError && e.fields.handle) {
					handleFor = format;
					return;
				}
				throw e;
			}
		});
	}

	async function saveHandle(handle: string): Promise<void> {
		const format = handleFor;
		if (format === null) return;
		try {
			await rooms.setHandle(handle);
			handleFor = null;
			handleProblem = null;
			await join(format);
		} catch (e) {
			handleProblem =
				e instanceof ApiError ? (e.fields.handle ?? e.message) : 'That handle did not save.';
		}
	}

	async function saveLeague(name: string): Promise<boolean> {
		const saved = await run(() => rooms.saveLeague(name, settings));
		if (saved) leagues = [saved, ...leagues];
		return saved !== undefined;
	}

	async function loadLobbies(): Promise<void> {
		try {
			lobbies = await rooms.lobbies();
		} catch {
			// The list fills on the next read.
		}
	}

	async function loadBoard(): Promise<void> {
		if (players.length > 0) return;
		players = (await rooms.board(boardFormat)).players;
	}

	/** A saved league's mock: its own rules with the Draft Pass, the nearest preset without, from
	 * its own slot or the one chosen on the form. A chosen slot drafts its settings rather than the
	 * saved league, since the API takes a league or settings, not both. */
	async function mockLeague(
		league: League,
		slot: LeagueSettings['slot'] = league.settings.slot
	): Promise<void> {
		const rerun = rerunOf(league.settings, exactRules);
		const own = slot === league.settings.slot;
		await run(() =>
			rerun.line === null && own
				? startMock(league.settings, league.id)
				: startMock({ ...rerun.settings, slot })
		);
	}

	/** Fill the form with the saved league the page was opened on, when the account has it. */
	function openLeague(id: string): void {
		const league = leagues.find((candidate) => candidate.id === id);
		if (!league) return;
		settings = rerunOf(league.settings, exactRules).settings;
		opened = league;
	}

	/** The setup starts from the site's context: the selected league's saved settings (or the league
	 * a link names), else the format chosen with no league. A mock the page reruns (`?from=`) keeps
	 * its own. */
	async function loadLeagues(): Promise<void> {
		await siteContext.load();
		const params = page.url.searchParams;
		if (!params.has('from')) settings = inFormat(settings, siteContext.format);
		try {
			leagues = await rooms.leagues();
			exactRules = hasFeature(siteContext.features, 'custom_scoring');
			const id = params.get('from')
				? null
				: (params.get('league') ?? siteContext.league?.settings_league_id ?? null);
			if (id) openLeague(id);
		} catch (e) {
			// Signed out: setup still works, a mock against bots starts, the other verbs ask to sign in.
			if (isSignedOut(e)) signedOut = true;
			else error = e;
		}
	}

	async function loadFrom(from: string): Promise<void> {
		try {
			const mock = await rooms.mock(from);
			settings = { ...mock.settings, slot: null };
			opened = null;
		} catch (e) {
			error = e;
		}
	}

	onMount(() => {
		const from = page.url.searchParams.get('from');
		left = leftLobby();
		void loadLeagues();
		if (from) void loadFrom(from);
		void loadLobbies();
		const poll = setInterval(() => void loadLobbies(), LOBBY_POLL_MS);
		return () => clearInterval(poll);
	});
</script>

<svelte:head>
	<title>New mock · Commish</title>
</svelte:head>

<Shell title="Mock draft" active="mock">
	<RoomLayout>
		<DisplayTitle size="page">New mock</DisplayTitle>
		<FactStrip
			label="This mock"
			cells={setupCells(
				settings,
				rounds,
				lobbies.find((l) => l.format === nearestLobby(settings))
			)}
		/>
		{#if handleFor}
			<HandlePrompt problem={handleProblem} {busy} onsave={saveHandle} />
		{/if}
		<div class="form">
			<ScoringRow
				scoring={settings.scoring}
				{exactRules}
				signInTo={signedOut ? signInHref(page.url.pathname) : null}
				onchange={(scoring: LeagueSettings['scoring']) => set({ scoring })}
			/>
			<SetupRow label="Teams">
				<ChipGroup label="Teams">
					{#each TEAM_CHOICES as n (n)}
						<Chip pressed={settings.teams === n} onclick={() => setTeams(n)}>{n}</Chip>
					{/each}
				</ChipGroup>
			</SetupRow>
			<SetupRow label="Your slot">
				<ChipGroup label="Your slot" variant="loose">
					{#each Array.from({ length: settings.teams }, (_, i) => i + 1) as n (n)}
						<Chip size="sm" pressed={settings.slot === n} onclick={() => set({ slot: n })}>{n}</Chip
						>
					{/each}
					<Chip size="sm" pressed={settings.slot === null} onclick={() => set({ slot: null })}
						>Random</Chip
					>
				</ChipGroup>
			</SetupRow>
			<RosterRow
				roster={settings.roster}
				lineup={settings.lineup}
				{rounds}
				onchange={(patch: Partial<LeagueSettings>) => set(patch)}
			/>
			<SetupRow label="Lineup">
				<ChipGroup label="Lineup">
					{#each LINEUP_CHOICES as c (c.lineup)}
						<Chip pressed={settings.lineup === c.lineup} onclick={() => set({ lineup: c.lineup })}
							>{c.label}</Chip
						>
					{/each}
				</ChipGroup>
			</SetupRow>
			<SetupRow label="Bots" note="how the other {settings.teams - 1} draft">
				<ChipGroup label="Bots">
					<Chip pressed>From where drafters take players</Chip>
				</ChipGroup>
			</SetupRow>
			<SetupRow label="Keepers">
				{#if keepersOpen}
					<KeeperEditor
						keepers={settings.keepers}
						teams={settings.teams}
						{rounds}
						{players}
						onchange={(keepers: LeagueSettings['keepers']) => set({ keepers })}
					/>
				{:else}
					<Chip
						onclick={async () => {
							keepersOpen = true;
							await run(loadBoard);
						}}
						>{settings.keepers.length > 0 ? `${settings.keepers.length} kept` : 'Add keepers'}</Chip
					>
				{/if}
			</SetupRow>
		</div>
		{#if !roundsOk}
			<p class="warn">
				The roster makes {rounds} rounds. Keep it from {MIN_ROUNDS} to {MAX_ROUNDS}.
			</p>
		{/if}
		<SaveLeague {signedOut} {busy} ready={roundsOk} onsave={saveLeague} />
		<ActionBar alert={error ? refusal : undefined} note={signedOut ? keepNote : undefined}>
			<Verb
				disabled={busy || !roundsOk}
				onclick={() =>
					opened ? mockLeague(opened, settings.slot) : run(() => startMock(settings))}
				>Start against bots</Verb
			>
			<Quiet disabled={busy} onclick={() => join(nearestLobby(settings))}
				>Join a lobby with people</Quiet
			>
		</ActionBar>
		{#snippet dock()}
			{#if left}<LeftLobby
					id={left}
					pollMs={LOBBY_POLL_MS}
					ondone={() => {
						forgetLeft();
						left = null;
					}}
				/>{/if}
			<SavedLeagues {leagues} {busy} {exactRules} onmock={mockLeague} />
			<LobbyList
				{lobbies}
				{busy}
				signInHref={signedOut ? signInHref(page.url.pathname) : null}
				onjoin={join}
			/>
		{/snippet}
	</RoomLayout>
</Shell>

<!-- The action bar's two lines: a verb that went wrong, said above the verbs, and where a signed-out
     mock is kept, under them. -->
{#snippet refusal()}
	<RoomNotice {error} subject="setup" returnTo={page.url.pathname} besideVerb />
{/snippet}

{#snippet keepNote()}
	<span class="keep">
		Signed out, a mock is kept in this browser.
		<Quiet size="sm" href={signInHref(page.url.pathname)}>Sign in to keep it</Quiet>
	</span>
{/snippet}

<style>
	.warn {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	.keep {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--s-2);
	}
</style>

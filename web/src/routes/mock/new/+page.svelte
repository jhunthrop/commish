<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Chip from '#lib/ui/Chip.svelte';
	import ChipGroup from '#lib/ui/ChipGroup.svelte';
	import Quiet from '#lib/ui/Quiet.svelte';
	import Shell from '#lib/ui/Shell.svelte';
	import Stepper from '#lib/ui/Stepper.svelte';
	import TextInput from '#lib/ui/TextInput.svelte';
	import Verb from '#lib/ui/Verb.svelte';
	import { startMock } from '#lib/room/actions.ts';
	import {
		ApiError,
		type BoardPlayer,
		type League,
		type LeagueSettings,
		type LobbyFilling,
		type LobbyFormat,
		rooms
	} from '#lib/room/api.ts';
	import RoomLayout from '#lib/room/RoomLayout.svelte';
	import RoomNotice from '#lib/room/RoomNotice.svelte';
	import Field from '#lib/room/setup/Field.svelte';
	import HandlePrompt from '#lib/room/setup/HandlePrompt.svelte';
	import KeeperEditor from '#lib/room/setup/KeeperEditor.svelte';
	import LobbyList from '#lib/room/setup/LobbyList.svelte';
	import SavedLeagues from '#lib/room/setup/SavedLeagues.svelte';
	import {
		LINEUP_CHOICES,
		MAX_ROUNDS,
		MIN_ROUNDS,
		ROSTER_FIELDS,
		SCORING_CHOICES,
		TEAM_CHOICES,
		defaultSettings,
		nearestLobby,
		roundsOf
	} from '#lib/room/setup/setup.ts';

	/** How often the lobbies' fill is read while the page is open. */
	const LOBBY_POLL_MS = 5000;

	let settings = $state<LeagueSettings>(defaultSettings());
	let leagues = $state<League[]>([]);
	let lobbies = $state<LobbyFilling[]>([]);
	let players = $state<BoardPlayer[]>([]);
	let keepersOpen = $state(false);
	let naming = $state(false);
	let leagueName = $state('');
	let busy = $state(false);
	let error = $state<unknown>(null);
	let handleFor = $state<LobbyFormat | null>(null);
	let handleProblem = $state<string | null>(null);

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

	async function saveLeague(): Promise<void> {
		const name = leagueName.trim();
		if (name === '') return;
		const saved = await run(() => rooms.saveLeague(name, settings));
		if (saved) {
			leagues = [saved, ...leagues];
			naming = false;
			leagueName = '';
		}
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

	onMount(() => {
		const from = page.url.searchParams.get('from');
		void (async () => {
			try {
				leagues = await rooms.leagues();
				if (from) {
					const mock = await rooms.mock(from);
					settings = { ...mock.settings, slot: null };
				}
			} catch (e) {
				// Signed out: setup still works, and the verbs ask to sign in.
				if (!(e instanceof ApiError && e.signedOut)) error = e;
			}
		})();
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
		<h2>New mock</h2>
		<p class="lede">
			Set it to your league once and save it. Against bots there is no clock, so a mock takes as
			long as your own picks do. Against people it is 30 seconds a pick.
		</p>
		{#if error}<RoomNotice {error} returnTo={page.url.pathname} />{/if}
		{#if handleFor}
			<HandlePrompt problem={handleProblem} {busy} onsave={saveHandle} />
		{/if}
		<div class="form">
			<Field label="Scoring">
				<ChipGroup label="Scoring">
					{#each SCORING_CHOICES as c (c.preset)}
						<Chip
							pressed={settings.scoring.preset === c.preset}
							onclick={() => set({ scoring: { preset: c.preset, custom: null } })}>{c.label}</Chip
						>
					{/each}
				</ChipGroup>
			</Field>
			<Field label="Custom scoring" note="your league's exact points">
				<Quiet size="sm" href="/pass">Import from ESPN, Yahoo or Sleeper with the Draft Pass</Quiet>
			</Field>
			<Field label="Teams">
				<ChipGroup label="Teams">
					{#each TEAM_CHOICES as n (n)}
						<Chip pressed={settings.teams === n} onclick={() => setTeams(n)}>{n}</Chip>
					{/each}
				</ChipGroup>
			</Field>
			<Field label="Your slot">
				<ChipGroup label="Your slot" variant="loose">
					{#each Array.from({ length: settings.teams }, (_, i) => i + 1) as n (n)}
						<Chip size="sm" pressed={settings.slot === n} onclick={() => set({ slot: n })}>{n}</Chip
						>
					{/each}
					<Chip size="sm" pressed={settings.slot === null} onclick={() => set({ slot: null })}
						>Random</Chip
					>
				</ChipGroup>
			</Field>
			<Field label="Roster" note="rounds follow from it: {rounds}">
				{#each ROSTER_FIELDS as f (f.key)}
					<Stepper
						label={f.label}
						value={settings.roster[f.key]}
						min={0}
						max={f.max}
						onchange={(v: number) => set({ roster: { ...settings.roster, [f.key]: v } })}
					/>
				{/each}
			</Field>
			<Field label="Lineup">
				<ChipGroup label="Lineup">
					{#each LINEUP_CHOICES as c (c.lineup)}
						<Chip pressed={settings.lineup === c.lineup} onclick={() => set({ lineup: c.lineup })}
							>{c.label}</Chip
						>
					{/each}
				</ChipGroup>
			</Field>
			<Field label="Bots" note="how the other {settings.teams - 1} draft">
				<ChipGroup label="Bots">
					<Chip pressed>From where drafters take players</Chip>
				</ChipGroup>
				<span class="later">Your league's last draft comes with a league import</span>
			</Field>
			<Field label="Keepers">
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
			</Field>
		</div>
		{#if !roundsOk}
			<p class="warn">
				The roster makes {rounds} rounds. Keep it from {MIN_ROUNDS} to {MAX_ROUNDS}.
			</p>
		{/if}
		<div class="go">
			<Verb disabled={busy || !roundsOk} onclick={() => run(() => startMock(settings))}
				>Start against bots</Verb
			>
			<Quiet disabled={busy} onclick={() => join(nearestLobby(settings))}
				>Join a lobby with people</Quiet
			>
			{#if naming}
				<TextInput
					bind:value={leagueName}
					maxlength={60}
					placeholder="Tuesday night, 12 PPR"
					label="League name"
					onenter={saveLeague}
				/>
				<Quiet disabled={busy || leagueName.trim() === ''} onclick={saveLeague}>Save</Quiet>
			{:else}
				<Quiet disabled={!roundsOk} onclick={() => (naming = true)}>Save as a league</Quiet>
			{/if}
		</div>
		{#snippet dock()}
			<SavedLeagues
				{leagues}
				{busy}
				onmock={(league: League) => run(() => startMock(league.settings, league.id))}
			/>
			<LobbyList {lobbies} {busy} onjoin={join} />
		{/snippet}
	</RoomLayout>
</Shell>

<style>
	h2 {
		margin: var(--s-2) 0 0;
		font-family: var(--font-num);
		font-weight: 800;
		font-size: 38px;
		line-height: 0.95;
		text-transform: uppercase;
	}

	.lede {
		margin: 0;
		color: var(--ink-2);
		max-width: 60ch;
	}

	.later {
		font-size: var(--t-xs);
		color: var(--ink-3);
	}

	.warn {
		margin: 0;
		color: var(--loss-ink);
		font-size: var(--t-sm);
	}

	.go {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-3);
		align-items: center;
		margin-top: var(--s-3);
	}

	@media (max-width: 760px) {
		h2 {
			font-size: 30px;
		}
	}
</style>

package app.trycommish.android

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import app.trycommish.api.Transport
import app.trycommish.api.models.BoardFormat
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeagueSettings
import app.trycommish.core.Cache
import app.trycommish.core.Clock
import app.trycommish.core.EncryptedSession
import app.trycommish.core.FileCache
import app.trycommish.core.Session
import app.trycommish.core.SessionEnd
import app.trycommish.core.SignInState
import app.trycommish.core.SignOut
import app.trycommish.core.SystemClock
import app.trycommish.core.account.AccountHooks
import app.trycommish.core.account.AccountScreenReads
import app.trycommish.core.account.AccountViewModel
import app.trycommish.core.account.ApiAccountScreenReads
import app.trycommish.core.board.ApiRunReads
import app.trycommish.core.board.BoardViewModel
import app.trycommish.core.board.RunReads
import app.trycommish.core.companion.ApiCompanionReads
import app.trycommish.core.companion.CompanionReads
import app.trycommish.core.companion.CompanionViewModel
import app.trycommish.core.companion.NewCompanionViewModel
import app.trycommish.core.leaguehome.ApiLeagueReads
import app.trycommish.core.leaguehome.LeagueHomeViewModel
import app.trycommish.core.leaguehome.LeagueReads
import app.trycommish.core.liveorder.OrderReader
import app.trycommish.core.liveorder.OrderShare
import app.trycommish.core.lobby.ApiLobbyReads
import app.trycommish.core.lobby.LobbyLandingViewModel
import app.trycommish.core.lobby.LobbyReads
import app.trycommish.core.lobby.LobbyReportViewModel
import app.trycommish.core.lobby.LobbySeatMemory
import app.trycommish.core.lobby.LobbyViewModel
import app.trycommish.core.lobby.PrefsLobbySeats
import app.trycommish.core.matchup.ApiMatchupReads
import app.trycommish.core.matchup.MatchupReads
import app.trycommish.core.matchup.MatchupViewModel
import app.trycommish.core.mock.ApiMockReads
import app.trycommish.core.mock.MockReads
import app.trycommish.core.mock.MockRoomViewModel
import app.trycommish.core.mock.MockSetupSeed
import app.trycommish.core.mock.MockSetupViewModel
import app.trycommish.core.mock.SharedMockViewModel
import app.trycommish.core.player.ApiPlayerReads
import app.trycommish.core.player.PlayerPageViewModel
import app.trycommish.core.player.PlayerReadsGraph
import app.trycommish.core.player.PlayerSheetViewModel
import app.trycommish.core.push.ApiPushApi
import app.trycommish.core.push.PendingRemoval
import app.trycommish.core.push.PrefsPushOffFlag
import app.trycommish.core.push.PushRegistrar
import app.trycommish.core.push.PushTap
import app.trycommish.core.rankings.ApiRankingsReads
import app.trycommish.core.rankings.RankingsReads
import app.trycommish.core.rankings.RankingsViewModel
import app.trycommish.core.record.ApiRecordReads
import app.trycommish.core.record.RecordReads
import app.trycommish.core.record.RecordViewModel
import app.trycommish.core.reference.AdpModel
import app.trycommish.core.reference.ClubPageModel
import app.trycommish.core.reference.ClubScreens
import app.trycommish.core.reference.ClubsModel
import app.trycommish.core.reference.CompareModel
import app.trycommish.core.reference.CompareReader
import app.trycommish.core.reference.ReferenceReads
import app.trycommish.core.reference.RunScreenViewModel
import app.trycommish.core.reference.ScheduleModel
import app.trycommish.core.room.phoneRoomConnector
import app.trycommish.core.sheet.ApiSheetReads
import app.trycommish.core.sheet.SheetDeps
import app.trycommish.core.sheet.SheetReads
import app.trycommish.core.sheet.SheetViewModel
import app.trycommish.core.shell.AccountReads
import app.trycommish.core.shell.ApiAccountReads
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.ShellRoute
import app.trycommish.core.shell.ShellViewModel
import app.trycommish.core.signin.ApiPairing
import app.trycommish.core.signin.SignIn
import app.trycommish.core.signin.SignInResult
import app.trycommish.core.start.ApiLineupReads
import app.trycommish.core.start.LineupReads
import app.trycommish.core.start.StartViewModel
import app.trycommish.core.trades.ApiTradeReads
import app.trycommish.core.trades.TradeMe
import app.trycommish.core.trades.TradeReads
import app.trycommish.core.trades.TradesViewModel
import app.trycommish.core.waivers.ApiWaiverReads
import app.trycommish.core.waivers.WaiverReads
import app.trycommish.core.waivers.WaiverViewModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.security.SecureRandom
import java.time.ZoneId

private const val TAG = "Commish"
private const val CLIP_LABEL = "Lineup"
private const val LOBBY_PREFS = "commish_lobby"
private const val SHEET_EXPORTS = "sheet-exports"

/**
 * The app's graph, built by hand (no DI framework, spec §6.2): one session, one transport, one cache,
 * one clock, the app's own coroutine scope, and the factories each screen's view model is made from.
 * Every dependency is a constructor argument, so a test builds the same pieces with fakes.
 */
class AppGraph(
    context: Context,
    apiBaseUrl: String = BuildConfig.API_BASE_URL,
    returnTo: String = BuildConfig.RETURN_TO,
) {
    val clock: Clock = SystemClock
    val zone: ZoneId get() = ZoneId.systemDefault()
    private val session: Session = EncryptedSession(context)
    private val cache: Cache = FileCache(context.cacheDir.resolve("answers")) { what, e -> Log.w(TAG, what, e) }
    private val transport = Transport(apiBaseUrl, token = { session.token })
    private val reads: LeagueReads = ApiLeagueReads(transport)
    private val account: AccountReads = ApiAccountReads(transport, BuildConfig.WORKOS_LOGOUT_HOST)
    private val lineups: LineupReads = ApiLineupReads(transport)
    private val matchups: MatchupReads = ApiMatchupReads(transport)
    private val waivers: WaiverReads = ApiWaiverReads(transport)
    private val trades: TradeReads = ApiTradeReads(transport)
    private val runs: RunReads = ApiRunReads(transport)

    /** The order's reads, shared by the Rankings and every in-season screen that ranks a player, one read
     * per route for a minute (Lane 226). */
    private val orderShare = OrderShare(ApiRankingsReads(transport), clock)
    private val rankings: RankingsReads = orderShare
    private val orders = OrderReader(orderShare)
    private val records: RecordReads = ApiRecordReads(transport)
    private val accountScreen: AccountScreenReads = ApiAccountScreenReads(transport)
    private val companions: CompanionReads = ApiCompanionReads(transport)
    private val mocks: MockReads = ApiMockReads(transport)
    private val sheets: SheetReads = ApiSheetReads(transport)

    /** Where an export's file waits for the share sheet (res/xml/sheet_exports.xml names it). */
    private val sheetExports = context.cacheDir.resolve(SHEET_EXPORTS)

    /** The cheat sheet, an empty one started in `format`; an export written to the share sheet's folder. */
    fun sheetViewModel(format: BoardFormat): SheetViewModel =
        SheetViewModel(SheetDeps(sheets, runs, cache, clock, zone, sheetExports), format, sessionEnd)

    /** A debug build started with the CommishCompanionReplay extra follows the API's recorded draft from the
     * companion's start page (the web's /companion/new?replay=1, COMPANION_REPLAY on a development API, refused
     * by any other); a release build never sets it. */
    var companionReplay: Boolean = false
        private set

    private val mutableLink = MutableStateFlow<ShellRoute?>(null)

    /** A screen an app link asked for (a /companion page), pushed by the shell once it is signed in. */
    val link: StateFlow<ShellRoute?> = mutableLink.asStateFlow()

    fun openLink(route: ShellRoute) {
        mutableLink.value = route
    }

    /** The shell pushed the screen the link asked for. */
    fun linkOpened() {
        mutableLink.value = null
    }

    /** The launch's development replay, honoured in a debug build only. */
    fun askReplay(asked: Boolean) {
        if (BuildConfig.DEBUG && asked) companionReplay = true
    }

    private val appContext: Context = context.applicationContext
    private val pushPrefs = context.getSharedPreferences(PrefsPushOffFlag.PREFS, Context.MODE_PRIVATE)
    private val pushPlatform = FirebasePush(appContext, pushPrefs)

    /** This phone's push (Lane 288): its FCM token on its own device, the Account's switches behind it. */
    private val push: PushRegistrar by lazy {
        // A removal a sign out without signal could not finish, with the signed-out device's own token.
        val pending = EncryptedSession(appContext, EncryptedSession.PUSH_PENDING)
        PushRegistrar(
            ApiPushApi(transport),
            pushPlatform,
            session,
            PendingRemoval(pending, ApiPushApi(Transport(apiBaseUrl, token = { pending.token }))),
            PrefsPushOffFlag(pushPrefs),
        ) { what, e -> Log.w(TAG, what, e) }
    }

    private val mutablePushed = MutableStateFlow<PushTap?>(null)

    /** A tapped push, opened by the shell once it is signed in. */
    val pushed: StateFlow<PushTap?> = mutablePushed.asStateFlow()

    fun openPush(tap: PushTap) {
        mutablePushed.value = tap
    }

    /** The shell opened the push's screen (or let it go). */
    fun pushOpened() {
        mutablePushed.value = null
    }

    /** The activity's notification prompt while it is up; null once it is gone. */
    fun pushAsker(ask: (suspend () -> Boolean)?) {
        pushPlatform.asker = ask
    }

    /** The app's start: a removal left from a sign out without signal is tried again; signed in, a phone that
     * allows push registers its token. */
    fun startPush() {
        appScope.launch { if (session.token != null) push.start() else push.launched() }
    }

    /** Firebase handed over a new token (CommishMessaging.onNewToken). */
    fun pushTokenArrived(token: String) {
        appScope.launch { push.tokenArrived(token) }
    }

    private val clipboard: ClipboardManager? = context.getSystemService(ClipboardManager::class.java)

    /** Work that must outlive a screen or a rotation: the sign-in's pairing, once its verifier is spent. */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** The one place the app's sign-in state turns (sign out, a refused token, a finished sign-in). */
    private val signInState =
        SignInState(
            session,
            cache,
            SignOut(session, cache, account::revokeDevice) { Log.w(TAG, "revoke device", it) },
            openLogout = { url -> openEphemeral(appContext, url, newTask = true) { Log.w(TAG, "open the logout", it) } },
        )

    /** Whether the device holds a token, for the tabs that need one. */
    val signedIn: StateFlow<Boolean> = signInState.signedIn

    /** Which account the shell shows, moved at each sign-in and sign-out: the shell rebuilds its tabs on it. */
    val generation: StateFlow<Int> = signInState.generation

    /** What the sign-in screen says about the last attempt or the last sign-out, if anything. */
    val signInMessage: StateFlow<String?> = signInState.message

    /** The sign-in screen's quiet line, if any ("Your account is deleted"). */
    val signInNotice: StateFlow<String?> = signInState.notice

    private val signIn = SignIn(apiBaseUrl, returnTo, Build.MODEL, ApiPairing(transport), session, SecureRandom())
    val signInFlow = SignInFlow(signIn, returnTo) { Log.w(TAG, "open the sign-in", it) }

    /** The API refused the token: forget it and every kept answer, and ask for a sign-in. */
    val sessionEnd: SessionEnd = signInState.sessionEnd

    fun leagueHomeViewModel(): LeagueHomeViewModel = LeagueHomeViewModel(reads, cache, clock, zone, sessionEnd)

    /** A league's Matchup, the member's game (`roster` null) or another team's by its first side's roster,
     * read again once a minute while it is on screen. */
    fun matchupViewModel(roster: Int? = null): MatchupViewModel = MatchupViewModel(matchups, cache, clock, zone, sessionEnd, roster)

    /** The board from the run: the draft's Board, or in season the Rest of season, with the verb that
     * follows whether the member follows a league. */
    fun boardViewModel(
        inSeason: Boolean,
        following: Boolean,
    ): BoardViewModel = BoardViewModel(runs, cache, clock, zone, inSeason, following, sessionEnd, orders)

    /** A league's Start screen, the lineup copied to the phone's clipboard. */
    fun startViewModel(league: LeagueHost): StartViewModel = StartViewModel(lineups, cache, clock, zone, league, ::copy, sessionEnd)

    /** A league's Waivers, a name copied to the phone's clipboard and the platform's waiver page opened
     * in the browser. */
    fun waiverViewModel(league: LeagueHost): WaiverViewModel =
        WaiverViewModel(waivers, cache, clock, zone, league, ::copy, ::openPage, sessionEnd)

    /** A league's Trades, an offer copied to the phone's clipboard and the platform's trade page opened in
     * the browser; the member's side named by the league's team and standing. */
    fun tradesViewModel(league: FollowedLeague): TradesViewModel =
        TradesViewModel(trades, cache, clock, zone, league.host, TradeMe.of(league), ::copy, ::openPage, sessionEnd)

    /** Opens a page in the browser from outside an activity's composition. */
    private fun openPage(url: String) {
        try {
            appContext.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "open a page", e)
        }
    }

    /** Puts the lineup or a player's name on the clipboard; false where the phone would not take it. */
    private fun copy(text: String): Boolean {
        val board = clipboard ?: return false
        return try {
            board.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, text))
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "copy to the clipboard", e)
            false
        }
    }

    /** The Rankings with no league: our order and the kickers' and defenses' week, named for the season,
     * opened with the search's letters where the shell's search opened it. */
    fun rankingsViewModel(
        inSeason: Boolean,
        query: String,
    ): RankingsViewModel = RankingsViewModel(rankings, cache, clock, zone, inSeason, query, sessionEnd)

    /** A followed draft, read every three seconds while it is on screen. */
    fun companionViewModel(id: String): CompanionViewModel = CompanionViewModel(id, companions, cache, clock, zone, sessionEnd)

    /** The companion's start page; `replay` where a site link asked for the development replay. */
    fun newCompanionViewModel(replay: Boolean): NewCompanionViewModel =
        NewCompanionViewModel(companions, sessionEnd, replay = replay || companionReplay)

    /** A mock room by its id: every verb a write the API answers with the room. */
    fun mockRoomViewModel(id: String): MockRoomViewModel = MockRoomViewModel(id, mocks, cache, clock, zone, sessionEnd)

    /** A mock's setup: from a draft's settings (Try another slot), else in the seed's format on its saved league. */
    fun mockSetupViewModel(
        from: LeagueSettings?,
        seed: MockSetupSeed,
    ): MockSetupViewModel = MockSetupViewModel(mocks, from, seed, sessionEnd)

    /** A shared mock by its link's code. */
    fun sharedMockViewModel(code: String): SharedMockViewModel = SharedMockViewModel(code, mocks, sessionEnd)

    private val lobbies: LobbyReads by lazy { ApiLobbyReads(transport) }

    /** The rooms the member joined, kept across a relaunch for the paired device. */
    private val lobbySeats: LobbySeatMemory by lazy { PrefsLobbySeats(appContext.getSharedPreferences(LOBBY_PREFS, Context.MODE_PRIVATE)) }

    /** One socket client for the app's life, so the room's affinity cookie carries across reconnects. */
    private val roomConnector by lazy { phoneRoomConnector() }

    /** The open house drafts under the setup, with the seats the paired device holds. */
    fun lobbyLandingViewModel(): LobbyLandingViewModel = LobbyLandingViewModel(lobbies, lobbySeats, { session.deviceId }, sessionEnd)

    /** A lobby room by its id: its read, then the room's socket. */
    fun lobbyViewModel(id: String): LobbyViewModel = LobbyViewModel(id, lobbies, roomConnector, { session.token }, clock, sessionEnd)

    /** A finished lobby's report. */
    fun lobbyReportViewModel(id: String): LobbyReportViewModel = LobbyReportViewModel(id, lobbies, mocks, sessionEnd)

    /** Our record from the run, with the schedule its weeks are read by. */
    fun recordViewModel(): RecordViewModel = RecordViewModel(records, cache, clock, zone, sessionEnd)

    /** The reads every player sheet and page is made over: the run's files, his page and his week. */
    private val players: PlayerReadsGraph by lazy {
        val reads = ApiPlayerReads(transport)
        PlayerReadsGraph(runs, reads, reads, cache, clock, zone, sessionEnd)
    }

    /** The sheet's view model for the player it opened on, his week read in the league shown. */
    fun playerSheetViewModel(
        player: SheetPlayer,
        league: FollowedLeague?,
    ): PlayerSheetViewModel = PlayerSheetViewModel(player, players, league)

    /** A player's page by his slug, his week read in the league shown. */
    fun playerPageViewModel(
        slug: String,
        league: FollowedLeague?,
    ): PlayerPageViewModel = PlayerPageViewModel(slug, players, league)

    /** The reference screens' reads (ADP, Compare, the clubs, a club, the schedule): the run's files, each
     * kept under its own key with its ETag, shared with the sheet and the page. */
    private val references: ReferenceReads by lazy { ReferenceReads(runs, ApiPlayerReads(transport), cache, clock) }

    /** ADP in a format as the run names it, null for the run's default. */
    fun adpViewModel(format: String?): RunScreenViewModel<AdpModel> = AdpModel.viewModel(format, references, zone, sessionEnd)

    /** Compare with its sides by their pages' slugs, in the followed league's format where the run carries it. */
    fun compareViewModel(
        slugs: List<String?>,
        league: FollowedLeague?,
    ): RunScreenViewModel<CompareModel> = CompareReader.viewModel(slugs, league, references, zone, sessionEnd, orders)

    fun clubsViewModel(): RunScreenViewModel<ClubsModel> = ClubScreens.clubs(references, zone, sessionEnd, orders)

    fun clubViewModel(abbr: String): RunScreenViewModel<ClubPageModel> = ClubScreens.club(abbr, references, zone, sessionEnd, orders)

    fun scheduleViewModel(): RunScreenViewModel<ScheduleModel> = ClubScreens.schedule(references, zone, sessionEnd)

    /** The platform's own page for a verb the app cannot make: his name on the clipboard first, so its
     * search takes it, then the page in the browser. */
    fun copyAndOpen(
        name: String,
        url: String,
    ) {
        copy(name)
        openPage(url)
    }

    /** The Account: its reads, the switches kept on this phone, this phone's id, and the app's hooks (sign
     * out through the session, a refused token, and the league switch read again once the leagues
     * changed). */
    fun accountViewModel(leaguesChanged: () -> Unit): AccountViewModel =
        AccountViewModel(
            accountScreen,
            cache,
            clock,
            zone,
            push,
            { session.deviceId },
            AccountHooks(::signOut, sessionEnd, leaguesChanged, signInState::holdsToken, signInState::deleted),
        )

    fun shellViewModel(): ShellViewModel = ShellViewModel(account, cache, clock, zone, sessionEnd, signInState)

    /** The member signs this phone out (the Account's Sign out, or its own row's): the API forgets its
     * sign-in when it can be reached, the phone forgets its token and every kept answer whatever the API
     * said, and the app returns to sign-in. */
    fun signOut() {
        appScope.launch {
            push.signingOut()
            signInState.signOut()
        }
    }

    /** Completes a sign-in from its return link in the app's scope, so a rotation cannot cancel it. */
    fun completeSignIn(link: String) {
        appScope.launch {
            when (val result = signInFlow.complete(link)) {
                SignInResult.SignedIn -> {
                    signInState.signedInNow()
                    push.start()
                }
                is SignInResult.Refused -> signInState.refused(result.message)
                SignInResult.Ignored -> Unit
            }
        }
    }
}

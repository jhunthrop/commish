package app.trycommish.android

import android.content.Context
import android.os.Build
import app.trycommish.api.Transport
import app.trycommish.core.Cache
import app.trycommish.core.Clock
import app.trycommish.core.EncryptedSession
import app.trycommish.core.FileCache
import app.trycommish.core.Session
import app.trycommish.core.SystemClock
import app.trycommish.core.leaguehome.ApiLeagueReads
import app.trycommish.core.leaguehome.LeagueChooser
import app.trycommish.core.leaguehome.LeagueHomeViewModel
import app.trycommish.core.leaguehome.LeagueReads
import app.trycommish.core.signin.ApiPairing
import app.trycommish.core.signin.SignIn
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.security.SecureRandom
import java.time.ZoneId

/**
 * The app's graph, built by hand (no DI framework, spec §6.2): one session, one transport, one cache,
 * one clock, and the factories each screen's view model is made from. Every dependency is a
 * constructor argument, so a test builds the same pieces with fakes.
 */
class AppGraph(
    context: Context,
    apiBaseUrl: String = BuildConfig.API_BASE_URL,
    returnTo: String = BuildConfig.RETURN_TO,
) {
    val clock: Clock = SystemClock
    val zone: ZoneId get() = ZoneId.systemDefault()
    val session: Session = EncryptedSession(context)
    private val cache: Cache = FileCache(context.cacheDir.resolve("answers"))
    private val transport = Transport(apiBaseUrl, token = { session.token })
    private val reads: LeagueReads = ApiLeagueReads(transport)

    private val signedInState = MutableStateFlow(session.token != null)

    /** Whether the device holds a token, for the tabs that need one. */
    val signedIn: StateFlow<Boolean> = signedInState.asStateFlow()

    val signIn = SignIn(apiBaseUrl, returnTo, Build.MODEL, ApiPairing(transport), session, SecureRandom())

    val leagueChooser = LeagueChooser(reads, cache, clock)

    fun leagueHomeViewModel(): LeagueHomeViewModel = LeagueHomeViewModel(reads, cache, clock, zone)

    /** Re-reads the session after a sign-in or a sign-out. */
    fun sessionChanged() {
        signedInState.value = session.token != null
    }
}

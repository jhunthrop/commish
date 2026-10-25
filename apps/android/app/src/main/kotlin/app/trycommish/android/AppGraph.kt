package app.trycommish.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.util.Log
import app.trycommish.api.Transport
import app.trycommish.api.models.LeagueHost
import app.trycommish.core.AppWords
import app.trycommish.core.Cache
import app.trycommish.core.Clock
import app.trycommish.core.EncryptedSession
import app.trycommish.core.FileCache
import app.trycommish.core.Session
import app.trycommish.core.SessionEnd
import app.trycommish.core.SystemClock
import app.trycommish.core.leaguehome.ApiLeagueReads
import app.trycommish.core.leaguehome.LeagueHomeViewModel
import app.trycommish.core.leaguehome.LeagueReads
import app.trycommish.core.shell.AccountReads
import app.trycommish.core.shell.ApiAccountReads
import app.trycommish.core.shell.ShellViewModel
import app.trycommish.core.signin.ApiPairing
import app.trycommish.core.signin.SignIn
import app.trycommish.core.signin.SignInResult
import app.trycommish.core.start.ApiLineupReads
import app.trycommish.core.start.LineupReads
import app.trycommish.core.start.StartViewModel
import kotlinx.coroutines.CancellationException
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
    private val account: AccountReads = ApiAccountReads(transport)
    private val lineups: LineupReads = ApiLineupReads(transport)
    private val clipboard: ClipboardManager? = context.getSystemService(ClipboardManager::class.java)

    /** Work that must outlive a screen or a rotation: the sign-in's pairing, once its verifier is spent. */
    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val signedInState = MutableStateFlow(session.token != null)
    private val signInMessageState = MutableStateFlow<String?>(null)

    /** Whether the device holds a token, for the tabs that need one. */
    val signedIn: StateFlow<Boolean> = signedInState.asStateFlow()

    /** What the sign-in screen says about the last attempt or the last sign-out, if anything. */
    val signInMessage: StateFlow<String?> = signInMessageState.asStateFlow()

    private val signIn = SignIn(apiBaseUrl, returnTo, Build.MODEL, ApiPairing(transport), session, SecureRandom())
    val signInFlow = SignInFlow(signIn, returnTo)

    /** The API refused the token: forget it and every kept answer, and ask for a sign-in. */
    val sessionEnd =
        SessionEnd {
            session.signOut()
            cache.clear()
            signInMessageState.value = AppWords.signedOut
            signedInState.value = false
        }

    fun leagueHomeViewModel(): LeagueHomeViewModel = LeagueHomeViewModel(reads, cache, clock, zone, sessionEnd)

    /** A league's Start screen, the lineup copied to the phone's clipboard. */
    fun startViewModel(league: LeagueHost): StartViewModel = StartViewModel(lineups, cache, clock, zone, league, ::copy, sessionEnd)

    /** Puts the lineup on the clipboard; false where the phone would not take it. */
    private fun copy(text: String): Boolean {
        val board = clipboard ?: return false
        return try {
            board.setPrimaryClip(ClipData.newPlainText(CLIP_LABEL, text))
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "copy the lineup", e)
            false
        }
    }

    fun shellViewModel(): ShellViewModel = ShellViewModel(account, cache, clock, zone, sessionEnd)

    /** The member signs this phone out: the API forgets its sign-in when it can be reached, and the
     * phone forgets its token and every kept answer whatever the API said. */
    fun signOut() {
        appScope.launch {
            try {
                session.deviceId?.let { account.revokeDevice(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (
                @Suppress("TooGenericExceptionCaught") e: Exception,
            ) {
                Log.w(TAG, "revoke device", e)
            } finally {
                session.signOut()
                cache.clear()
                signInMessageState.value = null
                signedInState.value = false
            }
        }
    }

    /** Completes a sign-in from its return link in the app's scope, so a rotation cannot cancel it. */
    fun completeSignIn(link: String) {
        appScope.launch {
            when (val result = signInFlow.complete(link)) {
                SignInResult.SignedIn -> {
                    signInMessageState.value = null
                    signedInState.value = true
                }
                is SignInResult.Refused -> signInMessageState.value = result.message
                SignInResult.Ignored -> Unit
            }
        }
    }
}

package app.trycommish.android

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.CommishTheme
import kotlinx.coroutines.CompletableDeferred

/** The one activity: the shell, the sign-in's return link (an app link) and a tapped push handed to the
 * graph, and the notification permission's prompt the Account's switch asks for (Lane 288). */
class MainActivity : ComponentActivity() {
    private val graph by lazy { (application as CommishApplication).graph }
    private var answer: CompletableDeferred<Boolean>? = null
    private val prompt =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            answer?.complete(granted)
            answer = null
        }

    /** The system prompt, answered when the member chooses. Before Android 13 there is none to show. */
    private suspend fun askNotifications(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        val pending = CompletableDeferred<Boolean>().also { answer = it }
        prompt.launch(Manifest.permission.POST_NOTIFICATIONS)
        return pending.await()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        graph.pushAsker(::askNotifications)
        setContent {
            CommishTheme {
                Shell(graph, onOpenLineup = ::openLineup)
            }
        }
        // A link that started the activity is handled once, not again after a rotation; so is the launch's
        // push registration (signed in, a phone that allows push registers its token).
        if (savedInstanceState == null) {
            graph.startPush()
            handle(intent)
        }
    }

    override fun onDestroy() {
        graph.pushAsker(null)
        answer?.complete(false)
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** The lineup on the web in a Custom Tab, for a league whose bar has no Lineup tab. */
    private fun openLineup(leagueId: String) {
        CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse("${BuildConfig.SITE_URL}/league/$leagueId/start"))
    }

    private fun handle(intent: Intent?) {
        graph.askReplay(intent?.getBooleanExtra(REPLAY_EXTRA, false) == true)
        graph.signInFlow.returnLink(intent)?.let(graph::completeSignIn)
        intent?.dataString?.let { SiteLinks.companion(it) ?: SiteLinks.mock(it) }?.let(graph::openLink)
        intent?.pushTap()?.let(graph::openPush)
    }

    private companion object {
        /** The launch extra a development build reads for the companion's replay (the iOS app's launch
         * argument CommishCompanionReplay). */
        const val REPLAY_EXTRA = "CommishCompanionReplay"
    }
}

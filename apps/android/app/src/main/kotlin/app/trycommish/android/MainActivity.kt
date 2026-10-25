package app.trycommish.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
import app.trycommish.design.CommishTheme

/** The one activity: the shell, and the sign-in's return link (an app link) handed to the graph. */
class MainActivity : ComponentActivity() {
    private val graph by lazy { (application as CommishApplication).graph }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CommishTheme {
                Shell(graph, onOpenLineup = ::openLineup)
            }
        }
        // A link that started the activity is handled once, not again after a rotation.
        if (savedInstanceState == null) handle(intent)
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
        graph.signInFlow.returnLink(intent)?.let(graph::completeSignIn)
    }
}

package app.trycommish.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.rememberNavController
import app.trycommish.core.signin.SignInResult
import app.trycommish.design.CommishTheme
import kotlinx.coroutines.launch

/** The one activity: the shell, and the sign-in's return link (an app link) handed to the flow. */
class MainActivity : ComponentActivity() {
    private val graph by lazy { (application as CommishApplication).graph }
    private val signInFlow by lazy { SignInFlow(graph.signIn) }
    private var signInMessage by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CommishTheme {
                val nav = rememberNavController()
                RootTabs(
                    league = {
                        LeagueTab(graph, signInFlow, signInMessage, onOpenLineup = ::openLineup)
                    },
                    nav = nav,
                )
            }
        }
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** The lineup on the web in a Custom Tab, until the app's own Start screen ships. */
    private fun openLineup(leagueId: String) {
        CustomTabsIntent.Builder().build().launchUrl(this, Uri.parse("${BuildConfig.SITE_URL}/league/$leagueId/start"))
    }

    private fun handle(intent: Intent?) {
        lifecycleScope.launch {
            when (val result = signInFlow.handle(intent)) {
                null -> Unit
                SignInResult.SignedIn -> {
                    signInMessage = null
                    graph.sessionChanged()
                }
                is SignInResult.Refused -> signInMessage = result.message
            }
        }
    }
}

package app.trycommish.android

import android.app.Activity
import android.app.Application
import android.content.Intent
import androidx.browser.customtabs.CustomTabsIntent
import androidx.test.core.app.ApplicationProvider
import app.trycommish.core.MemorySession
import app.trycommish.core.signin.PairedDevice
import app.trycommish.core.signin.SignIn
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.security.SecureRandom

/** The sign-in and the sign-out's logout open in an ephemeral Custom Tab (B168, B228; iOS's
 * theSignInSheetIsEphemeral), the logout in a task of its own, and a tab that cannot open is reported,
 * never thrown. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class BrowserTabsTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val logout = "https://api.workos.com/user_management/sessions/logout?session_id=s1"

    private fun started(): Intent = requireNotNull(shadowOf(app).nextStartedActivity) { "nothing was opened" }

    private fun Intent.ephemeral(): Boolean = getBooleanExtra(CustomTabsIntent.EXTRA_ENABLE_EPHEMERAL_BROWSING, false)

    @Test
    fun `the logout opens in an ephemeral tab of its own task`() {
        openEphemeral(app, logout, newTask = true) { throw AssertionError(it) }
        val intent = started()
        assertEquals(logout, intent.dataString)
        assertTrue(intent.ephemeral())
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    }

    @Test
    fun `the sign-in opens the API's login in an ephemeral tab`() {
        val signIn =
            SignIn(
                "https://api.trycommish.app",
                "https://trycommish.app/app/signed-in",
                "Pixel",
                { _, _, _, _ -> PairedDevice("token", "device") },
                MemorySession(),
                SecureRandom(),
            )
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        SignInFlow(signIn, "https://trycommish.app/app/signed-in") { throw AssertionError(it) }.launch(activity)
        val intent = requireNotNull(shadowOf(activity).nextStartedActivity) { "nothing was opened" }
        assertTrue(intent.dataString.orEmpty().startsWith("https://api.trycommish.app/auth/login?client=android"))
        assertTrue(intent.ephemeral())
    }

    @Test
    fun `a tab that cannot open is reported, not thrown`() {
        val failures = mutableListOf<Exception>()
        // A context that refuses every activity, as an odd default browser can.
        val refusing =
            object : android.content.ContextWrapper(app) {
                override fun startActivity(intent: Intent?) = throw SecurityException("refused")

                override fun startActivity(
                    intent: Intent?,
                    options: android.os.Bundle?,
                ) = throw SecurityException("refused")
            }
        openEphemeral(refusing, logout, newTask = true) { failures += it }
        assertEquals(listOf("refused"), failures.map { it.message })
    }
}

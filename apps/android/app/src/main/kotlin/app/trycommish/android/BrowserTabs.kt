package app.trycommish.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent

private const val TAG = "Commish"

/**
 * The browser tab the sign-in and the sign-out's WorkOS logout open in: ephemeral, so it shares no cookie
 * with the member's browser or with an earlier tab, and the WorkOS session a sign-in opens lives and dies
 * with its tab (B168, B228; iOS's prefersEphemeralWebBrowserSession).
 */
internal fun ephemeralTab(): CustomTabsIntent =
    CustomTabsIntent
        .Builder()
        .setShowTitle(true)
        .setEphemeralBrowsingEnabled(true)
        .build()

/**
 * Opens `url` in the ephemeral tab. A browser without the mode (Chrome before 136) opens a plain Custom
 * Tab, the same jar for the sign-in and the logout, and the app logs that it fell back. `newTask` for a
 * launch from outside an activity (the sign-out runs in the app's scope). Any failure to launch goes to
 * `onError`, never out to the caller: the phone has already signed out, or can sign in again.
 */
internal fun openEphemeral(
    context: Context,
    url: String,
    newTask: Boolean,
    onError: (Exception) -> Unit,
) {
    val tab = ephemeralTab()
    if (newTask) tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        val browser = CustomTabsClient.getPackageName(context, null)
        if (browser == null || !CustomTabsClient.isEphemeralBrowsingSupported(context, browser)) {
            Log.i(TAG, "the browser ${browser ?: "(none with Custom Tabs)"} has no ephemeral tabs: a plain Custom Tab")
        }
        tab.launchUrl(context, Uri.parse(url))
    } catch (
        @Suppress("TooGenericExceptionCaught") e: RuntimeException,
    ) {
        onError(e)
    }
}

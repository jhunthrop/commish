package app.trycommish.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.browser.customtabs.CustomTabsIntent

private const val TAG = "Commish"

/**
 * The browser tab the sign-in and the sign-out's WorkOS logout open in: ephemeral, so it shares no cookie
 * with the member's browser or with an earlier tab, and the WorkOS session a sign-in opens lives and dies
 * with its tab (B168, B228; iOS's prefersEphemeralWebBrowserSession). A browser without the mode (Chrome
 * before 136) opens a plain Custom Tab, the same jar for the sign-in and the logout.
 */
internal fun ephemeralTab(): CustomTabsIntent =
    CustomTabsIntent
        .Builder()
        .setShowTitle(true)
        .setEphemeralBrowsingEnabled(true)
        .build()

/** Opens the sign-out's WorkOS logout URL in an ephemeral tab from outside an activity, without waiting
 * on it: nothing comes back to the app, which has already signed out. */
internal fun openLogout(
    context: Context,
    url: String,
) {
    val tab = ephemeralTab()
    tab.intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
        tab.launchUrl(context, Uri.parse(url))
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "open the logout", e)
    }
}

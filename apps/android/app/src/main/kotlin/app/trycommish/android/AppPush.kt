package app.trycommish.android

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.trycommish.core.push.PushPermission
import app.trycommish.core.push.PushPlatform
import app.trycommish.core.push.PushRoute
import app.trycommish.design.Words
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

private const val TAG = "Commish"

/** The one notification channel every push arrives on, named through the words (Words.Push.channel). */
object PushChannel {
    const val ID = "leagues"

    /** Creates the channel (Android 8 and later keep it once made; making it again renames it). */
    fun create(context: Context) {
        val channel =
            NotificationChannel(ID, Words.Push.channel, NotificationManager.IMPORTANCE_HIGH).apply {
                description = Words.Push.channelLine
            }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }
}

/**
 * The phone's push (Lane 288): the permission (POST_NOTIFICATIONS on Android 13 and later, the app's
 * notifications switch on every version), the prompt through the activity's launcher, and Firebase
 * Messaging's token. A build without google-services.json has no FirebaseApp and so no token.
 */
class FirebasePush(
    private val context: Context,
    private val prefs: SharedPreferences,
) : PushPlatform {
    /** The prompt, set by the activity while it is up (its permission launcher); none, no prompt. */
    var asker: (suspend () -> Boolean)? = null

    override fun permission(): PushPermission {
        val enabled = NotificationManagerCompat.from(context).areNotificationsEnabled()
        return when {
            enabled && granted() -> PushPermission.Allowed
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !prefs.getBoolean(ASKED, false) ->
                PushPermission.NotAsked
            else -> PushPermission.Refused
        }
    }

    override suspend fun ask(): Boolean {
        val ask = asker ?: return false
        prefs.edit().putBoolean(ASKED, true).apply()
        return ask()
    }

    override suspend fun token(): String? {
        if (FirebaseApp.getApps(context).isEmpty()) return null
        return suspendCancellableCoroutine { done ->
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                if (!task.isSuccessful) Log.w(TAG, "push token", task.exception)
                done.resume(if (task.isSuccessful) task.result else null)
            }
        }
    }

    override suspend fun deleteToken() {
        if (FirebaseApp.getApps(context).isEmpty()) return
        suspendCancellableCoroutine { done ->
            FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { task ->
                if (!task.isSuccessful) Log.w(TAG, "push token delete", task.exception)
                done.resume(Unit)
            }
        }
    }

    private fun granted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private companion object {
        const val ASKED = "asked"
    }
}

/** A push's data as the intent that opens the app carries it: FCM puts a background push's data in the
 * launcher intent's extras, and a push shown here puts the same keys there. */
fun Intent.pushRoute(): PushRoute? {
    val path = getStringExtra(PushRoute.PATH_KEY) ?: return null
    return PushRoute.ofPath(path)
}

/**
 * Firebase Messaging's service: a new token goes to the registrar (onNewToken); a push that arrives while
 * the app is open is shown on the channel with the API's title and body, its tap opening the screen its
 * data names. In the background the system shows it on the same channel (the manifest's default).
 */
class CommishMessaging : FirebaseMessagingService() {
    private val graph get() = (application as CommishApplication).graph

    override fun onNewToken(token: String) {
        graph.pushTokenArrived(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val shown = message.notification ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val open =
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .apply { message.data.forEach { (key, value) -> putExtra(key, value) } }
        val tap =
            PendingIntent.getActivity(
                this,
                message.messageId.hashCode(),
                open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        val notification =
            NotificationCompat
                .Builder(this, PushChannel.ID)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(shown.title)
                .setContentText(shown.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(shown.body))
                .setAutoCancel(true)
                .setContentIntent(tap)
                .build()
        NotificationManagerCompat.from(this).notify(message.messageId.hashCode(), notification)
    }
}

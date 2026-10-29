package app.trycommish.core.push

import android.content.SharedPreferences
import app.trycommish.api.Transport
import app.trycommish.api.models.PushRegistration
import app.trycommish.core.account.done
import kotlinx.coroutines.CancellationException
import java.util.UUID
import app.trycommish.api.models.PushPlatform as WirePlatform

/** Whether the phone lets Commish show a push: not asked yet, allowed, or refused (in its settings). */
enum class PushPermission { NotAsked, Allowed, Refused }

/**
 * The phone's side of push: its permission, the system prompt (Android 13 and later; earlier phones
 * allow push unless the member turned it off), and the FCM registration token. The app's is Firebase
 * Messaging and the notification permission; a test's records the calls.
 */
interface PushPlatform {
    fun permission(): PushPermission

    /** The system prompt: whether the member allowed it. */
    suspend fun ask(): Boolean

    /** This install's FCM token; null where Firebase is not set up in this build. */
    suspend fun token(): String?

    /** Forgets this install's token, so the next account on the phone gets a new one. */
    suspend fun deleteToken()
}

/** What the Account's switches ask of push: the permission, turning push on (asking first when the phone
 * has not been asked) and off. */
interface PushControl {
    fun permission(): PushPermission

    /** Push on for this phone: the prompt if never shown, then the token registered once allowed. Answers
     * the permission it ended on. */
    suspend fun enable(): PushPermission

    /** Push off for this phone: its token taken off the account. */
    suspend fun disable()
}

/** This phone's registration on the API (PUT and DELETE /devices/{id}/push, Lane 262). */
interface PushApi {
    suspend fun register(
        device: String,
        token: String,
    )

    suspend fun remove(device: String)
}

/** The registration through the generated client, as an FCM token. */
class ApiPushApi(
    private val transport: Transport,
) : PushApi {
    override suspend fun register(
        device: String,
        token: String,
    ) = transport.devices().registerPush(UUID.fromString(device), PushRegistration(WirePlatform.fcm, token)).done()

    override suspend fun remove(device: String) = transport.devices().removePush(UUID.fromString(device)).done()
}

/** Whether every switch went off on this phone, kept across launches. */
interface PushOffFlag {
    var off: Boolean
}

/** The flag in the app's preferences. */
class PrefsPushOffFlag(
    private val prefs: SharedPreferences,
) : PushOffFlag {
    override var off: Boolean
        get() = prefs.getBoolean(KEY, false)
        set(value) {
            prefs.edit().putBoolean(KEY, value).apply()
        }

    companion object {
        /** The preferences file the flag is kept in. */
        const val PREFS = "commish_push"
        private const val KEY = "off"
    }
}

/** The flag in memory, for a test. */
class MemoryPushOffFlag(
    override var off: Boolean = false,
) : PushOffFlag

/**
 * This phone's push registration (spec §5.3, Lane 288; the iOS PushRegistrar's): the FCM token on its own
 * device on the first run signed in and at each launch signed in, again when Firebase hands over a new
 * one (onNewToken), taken off when every switch goes off and at sign out. Whether push is wanted is kept
 * on the phone, so a launch after every switch went off registers nothing; it starts wanted. The
 * permission is never asked here: only the Account's switch asks. `log` hears a failed write.
 */
class PushRegistrar(
    private val api: PushApi,
    private val platform: PushPlatform,
    private val deviceId: () -> String?,
    private val flag: PushOffFlag,
    private val log: (String, Throwable) -> Unit,
) : PushControl {
    /** Whether this phone wants pushes: true until every switch goes off here. */
    val wanted: Boolean get() = !flag.off

    /** Signed in (at launch, or a sign-in just finished): a phone that allows push and wants it registers its
     * token. Never shows the prompt. */
    suspend fun start() {
        if (!wanted || platform.permission() != PushPermission.Allowed) return
        platform.token()?.let { tokenArrived(it) }
    }

    /** Firebase handed over a token (onNewToken): registered on this phone's device while push is wanted
     * and the phone is signed in. */
    suspend fun tokenArrived(token: String) {
        if (!wanted) return
        val device = deviceId() ?: return
        attempt("push registration") { api.register(device, token) }
    }

    override fun permission(): PushPermission = platform.permission()

    override suspend fun enable(): PushPermission {
        var permission = platform.permission()
        if (permission == PushPermission.NotAsked) {
            permission = if (platform.ask()) PushPermission.Allowed else PushPermission.Refused
        }
        if (permission != PushPermission.Allowed) return permission
        flag.off = false
        platform.token()?.let { tokenArrived(it) }
        return permission
    }

    override suspend fun disable() {
        flag.off = true
        remove()
    }

    /** The phone signs out: its token comes off the account before the device is revoked, Firebase forgets
     * it, and the next account on this phone starts wanting push again. */
    suspend fun signingOut() {
        remove()
        attempt("push token delete") { platform.deleteToken() }
        flag.off = false
    }

    private suspend fun remove() {
        val device = deviceId() ?: return
        attempt("push removal") { api.remove(device) }
    }

    private suspend fun attempt(
        what: String,
        step: suspend () -> Unit,
    ) {
        try {
            step()
        } catch (e: CancellationException) {
            throw e
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            log(what, e)
        }
    }
}

/** Push that answers a fixed permission and counts its calls, for a test or a snapshot: `enable` answers
 * `asked` when the phone was never asked. */
class StaticPush(
    var current: PushPermission = PushPermission.Allowed,
    private val asked: PushPermission = PushPermission.Allowed,
) : PushControl {
    var enabled = 0
        private set
    var disabled = 0
        private set

    override fun permission(): PushPermission = current

    override suspend fun enable(): PushPermission {
        enabled++
        if (current == PushPermission.NotAsked) current = asked
        return current
    }

    override suspend fun disable() {
        disabled++
    }
}

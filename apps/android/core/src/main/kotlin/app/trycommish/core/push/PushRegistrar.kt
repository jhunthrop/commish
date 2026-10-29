package app.trycommish.core.push

import android.content.SharedPreferences
import app.trycommish.api.ApiFailure
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.api.models.PushRegistration
import app.trycommish.core.Session
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

/** A removal the phone could not finish at sign out (no signal): the signed-out device's id and token kept in
 * their own encrypted store, and the client that takes the token off with that token (Lane 288 security
 * M1). Until it is done, the previous member's pushes would keep arriving here. */
class PendingRemoval(
    val store: Session,
    val api: PushApi,
)

/**
 * This phone's push registration (spec §5.3, Lane 288; the iOS PushRegistrar's): the FCM token on its own
 * device on the first run signed in and at each launch signed in, again when Firebase hands over a new
 * one (onNewToken), taken off when every switch goes off and at sign out. Whether push is wanted is kept
 * on the phone, so a launch after every switch went off registers nothing; it starts wanted. A token
 * registers only while the phone allows push, and the permission is never asked here: only the
 * Account's switch asks. A removal that failed at sign out is kept and tried again at the next launch
 * before any registration, and a registration the API refuses because another account's device holds
 * the token tries that removal, then once more. `log` hears a failed write.
 */
class PushRegistrar(
    private val api: PushApi,
    private val platform: PushPlatform,
    private val session: Session,
    private val pending: PendingRemoval,
    private val flag: PushOffFlag,
    private val log: (String, Throwable) -> Unit,
) : PushControl {
    /** Whether this phone wants pushes: true until every switch goes off here. */
    val wanted: Boolean get() = !flag.off

    /** At launch, signed in or not: a removal left from a sign out without signal is tried again. */
    suspend fun launched() = finishPendingRemoval()

    /** Signed in (at launch, or a sign-in just finished): a phone that allows push and wants it registers its
     * token. Never shows the prompt. */
    suspend fun start() {
        finishPendingRemoval()
        if (!wanted || platform.permission() != PushPermission.Allowed) return
        platform.token()?.let { tokenArrived(it) }
    }

    /** Firebase handed over a token (onNewToken): registered on this phone's device while push is wanted and
     * allowed and the phone is signed in, after any removal left from a sign out. A token another account's
     * device holds (409) tries that removal and registers once more. */
    suspend fun tokenArrived(token: String) {
        finishPendingRemoval()
        if (!wanted || platform.permission() != PushPermission.Allowed) return
        val device = session.deviceId ?: return
        try {
            api.register(device, token)
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiFailure) {
            if (e.status != HTTP_CONFLICT) return log("push registration", e)
            finishPendingRemoval()
            attempt("push registration again") { api.register(device, token) }
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            log("push registration", e)
        }
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
        session.deviceId?.let { remove(it, api) }
    }

    /** The phone signs out: its token comes off the account before the device is revoked, Firebase forgets it,
     * and the next account on this phone starts wanting push again. Without signal the removal is kept, with
     * this device's token, for the next launch. */
    suspend fun signingOut() {
        flag.off = false
        val device = session.deviceId ?: return
        if (!remove(device, api)) session.token?.let { pending.store.signIn(it, device) }
        attempt("push token delete") { platform.deleteToken() }
    }

    /** The removal a sign out could not finish, with the signed-out device's own token; done once the API takes
     * it or says the device is gone (its token refused, or no such device). */
    private suspend fun finishPendingRemoval() {
        val device = pending.store.deviceId ?: return
        if (remove(device, pending.api)) pending.store.signOut()
    }

    /** Whether the device's token is off the account: taken off, or the device is gone already. */
    private suspend fun remove(
        device: String,
        client: PushApi,
    ): Boolean =
        try {
            client.remove(device)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Unauthorized) {
            true
        } catch (e: ApiFailure) {
            log("push removal", e)
            e.status == HTTP_NOT_FOUND
        } catch (
            @Suppress("TooGenericExceptionCaught") e: Exception,
        ) {
            log("push removal", e)
            false
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

    private companion object {
        const val HTTP_CONFLICT = 409
        const val HTTP_NOT_FOUND = 404
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

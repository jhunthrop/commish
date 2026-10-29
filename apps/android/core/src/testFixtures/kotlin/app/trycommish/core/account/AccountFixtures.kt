package app.trycommish.core.account

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.NotificationKinds
import app.trycommish.api.models.NotificationSettings
import app.trycommish.api.models.NotificationSettingsUpdate
import kotlinx.coroutines.delay
import java.io.File
import java.io.IOException

/** The Account's answers from the shared in-season fixture (GET /me, /leagues/attached, /devices) at the
 * week clock, and the ids the iOS snapshots show. */
object AccountFixtures {
    private val inseason = File(System.getProperty("fixtures"), "inseason")

    /** This phone: the fixture's paired iPhone, marked as this phone. */
    const val PHONE = "6f1d1c52-2626-4a26-9a26-0000000000d1"

    /** The other device, a Chrome extension never used. */
    const val OTHER = "6f1d1c52-2626-4a26-9a26-0000000000d2"

    /** The FFPC league, the ESPN stand-in and a league before its draft: three platforms, two phases. */
    val SHOWN =
        listOf(
            "6f1d1c52-2626-4a26-9a26-000000000026",
            "6f1d1c52-2626-4a26-9a26-000000000035",
            "6f1d1c52-2626-4a26-9a26-000000000040",
        )

    fun me(): AccountRead = decodeEnvelope(File(inseason, "me.json").readText())

    fun leagues(): List<AttachedRead> = decodeEnvelope(File(inseason, "leagues-attached.json").readText())

    fun devices(): List<DeviceRead> = decodeEnvelope(File(inseason, "devices.json").readText())

    /** The account with the three shown leagues. */
    fun shown(): List<AttachedRead> = leagues().filter { it.id in SHOWN }
}

/**
 * The Account routes as the fixture answers them, recording each write. `offline` makes every call fail
 * as with no signal; `refuse` answers every call with a 401; `restoreRefusal` refuses a restore with the
 * API's sentence; `flag` is /billing/plans' free_season.
 */
class StubAccountScreen(
    var account: AccountRead = AccountFixtures.me(),
    var leagues: List<AttachedRead> = AccountFixtures.shown(),
    var paired: List<DeviceRead> = AccountFixtures.devices(),
    var flag: Boolean? = null,
) : AccountScreenReads {
    var offline = false
    var refuse = false
    var restoreRefusal: String? = null

    /** How long a restore takes to answer, in milliseconds of the test's clock (an Undo on a slow network). */
    var restoreDelay = 0L
    var detached: List<String> = emptyList()
    var restored: List<String> = emptyList()
    var revoked: List<String> = emptyList()

    private fun check() {
        if (refuse) throw Unauthorized()
        if (offline) throw IOException("no signal")
    }

    override suspend fun me(): AccountRead = account.also { check() }

    override suspend fun attached(): List<AttachedRead> = leagues.also { check() }

    override suspend fun detach(id: String) {
        check()
        detached = detached + id
    }

    override suspend fun restore(id: String) {
        delay(restoreDelay)
        check()
        restoreRefusal?.let { throw ApiFailure(FORBIDDEN, "many_leagues", it) }
        restored = restored + id
    }

    override suspend fun devices(): List<DeviceRead> = paired.also { check() }

    override suspend fun revokeDevice(id: String) {
        check()
        revoked = revoked + id
        paired = paired.filter { it.id != id }
    }

    override suspend fun freeSeasonFlag(): Boolean? = flag.also { check() }

    /** What a delete throws instead of its 204 (the API's refusal), if anything. */
    var deleteRefusal: Exception? = null

    /** Each email a delete was sent with. */
    var deletions: List<String> = emptyList()

    override suspend fun deleteAccount(email: String) {
        deletions = deletions + email
        check()
        deleteRefusal?.let { throw it }
    }

    /** Each push settings change written, in order. */
    var notificationChanges: List<NotificationSettingsUpdate> = emptyList()

    /** The account with the change applied over its settings (the standard ones when it has none), as
     * PATCH /me answers. */
    override suspend fun updateNotifications(change: NotificationSettingsUpdate): AccountRead {
        check()
        notificationChanges = notificationChanges + change
        val held = account.notifications
        val kinds = change.kinds
        account =
            account.copy(
                notifications =
                    NotificationSettings(
                        timeZone = change.timeZone ?: held?.timeZone ?: "America/New_York",
                        quietStart = change.quietStart ?: held?.quietStart ?: "23:00",
                        quietEnd = change.quietEnd ?: held?.quietEnd ?: "08:00",
                        kinds =
                            NotificationKinds(
                                starterStatus = kinds?.starterStatus ?: held?.kinds?.starterStatus ?: true,
                                weekReads = kinds?.weekReads ?: held?.kinds?.weekReads ?: true,
                                waiverClaims = kinds?.waiverClaims ?: held?.kinds?.waiverClaims ?: true,
                            ),
                    ),
            )
        return account
    }

    private companion object {
        const val FORBIDDEN = 403
    }
}

package app.trycommish.core.account

import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Envelope
import app.trycommish.api.HTTP_UNAUTHORIZED
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.api.data
import app.trycommish.api.infrastructure.HttpResponse
import app.trycommish.api.models.AccountDeletion
import app.trycommish.api.models.AccountUpdate
import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.LeaguePhase
import app.trycommish.api.models.LeagueStanding
import app.trycommish.api.models.NotificationSettings
import app.trycommish.api.models.NotificationSettingsUpdate
import io.ktor.client.statement.bodyAsText
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import java.util.UUID

/** The part of GET /me the Account reads. A field this screen can go without parses when absent, so an
 * older or newer API's answer still reads. */
@Serializable
data class AccountRead(
    val email: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    val handle: String? = null,
    /** The account's features by their API names ("many_leagues"); a name this build does not know is kept. */
    val features: List<String> = emptyList(),
    @SerialName("draft_pass") val draftPass: PlanSource? = null,
    val membership: PlanSource? = null,
    /** The push switches and quiet hours (Lane 262); absent from an older API, read as the defaults. */
    val notifications: NotificationSettings? = null,
)

/** Where a pass or a membership came from ("purchase", "subscription", "grant"). */
@Serializable
data class PlanSource(
    val source: String? = null,
)

/** A followed league as GET /leagues/attached sends it, the part the table reads. */
@Serializable
data class AttachedRead(
    val id: String,
    val host: LeagueHost,
    val name: String = "",
    @SerialName("team_name") val teamName: String = "",
    val standing: LeagueStanding? = null,
    @SerialName("last_read_at") val lastReadAt: String? = null,
    val phase: LeaguePhase = LeaguePhase.in_season,
    @SerialName("draft_at") val draftAt: String? = null,
    @SerialName("playoff_start_week") val playoffStartWeek: Int? = null,
)

/** A paired device as GET /devices sends it. */
@Serializable
data class DeviceRead(
    val id: String,
    val name: String,
    @SerialName("created_at") val createdAt: String,
    @SerialName("last_used_at") val lastUsedAt: String? = null,
)

/** The part of GET /billing/plans the app reads: only the founder's one switch, never a price. */
@Serializable
private data class PlansRead(
    @SerialName("free_season") val freeSeason: Boolean? = null,
)

/**
 * The Account screen's reads and writes (web/src/lib/account/AccountPage.svelte, the iOS
 * AccountScreenAPI): the account, the leagues followed with detach and restore, the paired devices with
 * unpair, and the free-season flag. A 401 throws [Unauthorized]; an error envelope throws [ApiFailure]
 * with the API's sentence. Sign out is the session's (AppGraph.signOut).
 */
interface AccountScreenReads {
    suspend fun me(): AccountRead

    suspend fun attached(): List<AttachedRead>

    /** Stops following a league; the attachment is kept as detached, so [restore] takes it back. */
    suspend fun detach(id: String)

    /** Follows a detached league again; a second live league needs many_leagues (403, its sentence). */
    suspend fun restore(id: String)

    suspend fun devices(): List<DeviceRead>

    /** Unpairs a device: its token opens nothing from the next request on. */
    suspend fun revokeDevice(id: String)

    /** /billing/plans `free_season`: null from an API that sends none. */
    suspend fun freeSeasonFlag(): Boolean?

    /** Deletes the account (POST /me/delete, Lane 233) with the email the member typed: nothing to read on a
     * 204. A 400 throws the API's sentence for the email, a 409 its sentence (a membership that still
     * renews), a 401 [Unauthorized]. */
    suspend fun deleteAccount(email: String)

    /** Writes the push settings (PATCH /me `notifications`) and answers the account as the API now holds it. */
    suspend fun updateNotifications(change: NotificationSettingsUpdate): AccountRead
}

/** The Account's routes through the generated clients. */
class ApiAccountScreenReads(
    private val transport: Transport,
) : AccountScreenReads {
    override suspend fun me(): AccountRead = transport.auth().getMe().data()

    override suspend fun attached(): List<AttachedRead> = transport.leagueSync().listAttached().data()

    override suspend fun detach(id: String) = transport.leagueSync().detachLeague(UUID.fromString(id)).done()

    override suspend fun restore(id: String) = transport.leagueSync().restoreLeague(UUID.fromString(id)).done()

    override suspend fun devices(): List<DeviceRead> = transport.devices().listDevices().data()

    override suspend fun revokeDevice(id: String) = transport.devices().revokeDevice(UUID.fromString(id)).done()

    override suspend fun freeSeasonFlag(): Boolean? =
        transport
            .billing()
            .getPlans()
            .data<PlansRead>()
            .freeSeason

    override suspend fun updateNotifications(change: NotificationSettingsUpdate): AccountRead =
        transport.auth().updateMe(AccountUpdate(notifications = change)).data()

    override suspend fun deleteAccount(email: String) {
        val answer = transport.auth().deleteMe(AccountDeletion(email))
        if (answer.status == HTTP_NO_CONTENT) return
        answer.done(field = "email")
    }
}

private const val HTTP_NO_CONTENT = 204

/** A write's answer: nothing to read when it went through, the API's failure when it did not, in the
 * refused `field`'s own sentence where the API names one ("Type the email you sign in with"). */
internal suspend fun HttpResponse<*>.done(field: String? = null) {
    if (status == HTTP_UNAUTHORIZED) throw Unauthorized()
    val envelope = CommishJson.decodeFromString<Envelope<JsonElement>>(response.bodyAsText())
    val error = envelope.error
    if (!envelope.ok || error != null) {
        val fields = error?.fields.orEmpty()
        val sentence = field?.let { fields[it] } ?: error?.message.orEmpty()
        throw ApiFailure(status, error?.code ?: "unknown", sentence, fields)
    }
}

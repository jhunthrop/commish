package app.trycommish.core.shell

import app.trycommish.api.CommishJson
import app.trycommish.api.Envelope
import app.trycommish.api.HTTP_UNAUTHORIZED
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.api.bodyText
import app.trycommish.api.models.DeviceSignOut
import app.trycommish.api.models.LeagueChoice
import kotlinx.serialization.SerializationException
import java.net.URI
import java.util.UUID

/** The shell's reads and writes on the account: GET /me's body whole (kept as the API sent it), the
 * league it selects, and revoking this phone. A 401 throws [Unauthorized]. */
interface AccountReads {
    suspend fun me(): String

    /** PUT /me/league: the site selects this followed league, so the web opens on it too. True when
     * the site took it; any other answer but a 401 (a league the API no longer lists, an older API) is
     * false and no change for the app. */
    suspend fun selectLeague(leagueId: String): Boolean

    /** DELETE /devices/{id} with this phone's own id: the API forgets its sign-in and answers the WorkOS
     * logout URL that ends the browser session the sign-in opened (Lane 225), null for a phone paired
     * before the API kept that session or for any answer without one. */
    suspend fun revokeDevice(deviceId: String): String?
}

/** The account's calls through the generated clients; a sign-out's logout URL is taken only when it names
 * `logoutHost` (WorkOS's API; a rehearsal's stub in a debug build). */
class ApiAccountReads(
    private val transport: Transport,
    private val logoutHost: String = WORKOS_LOGOUT_HOST,
) : AccountReads {
    override suspend fun me(): String = transport.auth().getMe().bodyText()

    override suspend fun selectLeague(leagueId: String): Boolean {
        val answer = transport.leagueSync().selectLeague(LeagueChoice(leagueId = UUID.fromString(leagueId)))
        if (answer.status == HTTP_UNAUTHORIZED) throw Unauthorized()
        return answer.success
    }

    override suspend fun revokeDevice(deviceId: String): String? =
        logoutUrlOf(transport.devices().revokeDevice(UUID.fromString(deviceId)).bodyText(), logoutHost)
}

/** The host WorkOS's logout URLs name (usermanagement GetLogoutURL). */
const val WORKOS_LOGOUT_HOST = "api.workos.com"

/** The logout URL in a sign-out's answer: `data.url` when it is an https link on `host`, null for
 * `{url: null}`, `data: null`, an error envelope, a body that is not one, or a link anywhere else. */
internal fun logoutUrlOf(
    body: String,
    host: String = WORKOS_LOGOUT_HOST,
): String? {
    val envelope =
        try {
            CommishJson.decodeFromString<Envelope<DeviceSignOut>>(body)
        } catch (e: SerializationException) {
            return null
        } catch (e: IllegalArgumentException) {
            return null
        }
    if (!envelope.ok || envelope.error != null) return null
    val url = envelope.data?.url ?: return null
    val parsed = runCatching { URI(url) }.getOrNull() ?: return null
    val named = parsed.host == host.substringBefore(':') && parsed.port == portOf(host)
    return url.takeIf { parsed.scheme == HTTPS && parsed.rawUserInfo == null && named }
}

/** The port a host override names ("localhost:18443"), -1 for none, as java.net.URI reads an absent one. */
private fun portOf(host: String): Int = host.substringAfter(':', "").toIntOrNull() ?: -1

private const val HTTPS = "https"

package app.trycommish.core.shell

import app.trycommish.api.HTTP_UNAUTHORIZED
import app.trycommish.api.Transport
import app.trycommish.api.Unauthorized
import app.trycommish.api.bodyText
import app.trycommish.api.models.LeagueChoice
import java.util.UUID

/** The shell's reads and writes on the account: GET /me's body whole (kept as the API sent it), the
 * league it selects, and revoking this phone. A 401 throws [Unauthorized]. */
interface AccountReads {
    suspend fun me(): String

    /** PUT /me/league: the site selects this followed league, so the web opens on it too. Any answer
     * but a 401 is no change for the app (a league the API no longer lists, an older API). */
    suspend fun selectLeague(leagueId: String)

    /** DELETE /devices/{id}: the API forgets this phone's sign-in. */
    suspend fun revokeDevice(deviceId: String)
}

/** The account's calls through the generated clients. */
class ApiAccountReads(
    private val transport: Transport,
) : AccountReads {
    override suspend fun me(): String = transport.auth().getMe().bodyText()

    override suspend fun selectLeague(leagueId: String) {
        val answer = transport.leagueSync().selectLeague(LeagueChoice(leagueId = UUID.fromString(leagueId)))
        if (answer.status == HTTP_UNAUTHORIZED) throw Unauthorized()
    }

    override suspend fun revokeDevice(deviceId: String) {
        transport.devices().revokeDevice(UUID.fromString(deviceId))
    }
}

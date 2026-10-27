package app.trycommish.core.lobby

import app.trycommish.api.ApiFailure
import app.trycommish.api.CommishJson
import app.trycommish.api.Envelope
import app.trycommish.api.Transport
import app.trycommish.api.bodyText
import app.trycommish.api.data
import app.trycommish.api.infrastructure.HttpResponse
import app.trycommish.api.models.AccountUpdate
import app.trycommish.api.models.LobbyFilling
import app.trycommish.api.models.LobbyFormat
import app.trycommish.api.models.LobbyJoin
import app.trycommish.api.models.LobbyRoom
import app.trycommish.api.models.LobbySeat
import app.trycommish.api.models.MockReport
import app.trycommish.api.models.RoomCard
import kotlinx.serialization.json.JsonElement
import java.util.UUID

/** A join refused because the account has no handle yet (409 with the field `handle`): the API's sentence. */
class LobbyHandleNeeded(
    override val message: String,
) : Exception(message)

/**
 * The lobby's calls (web/src/lib/room/api.ts `rooms`), the iOS LobbyAPI's: the formats and how full each filling
 * room is, a seat in one, the room with its board, leaving it, the turn's call, the report, and the handle a join
 * needs. Picks and the queue go over the room's socket, never through these. A 401 throws
 * [app.trycommish.api.Unauthorized], any other refusal [ApiFailure] with the API's sentence. The seam the view
 * models' tests replace with a stub.
 */
interface LobbyReads {
    /** GET /lobbies: each format and how full its filling room is, in the setup page's order. */
    suspend fun lobbies(): List<LobbyFilling>

    /** POST /lobbies/join: a seat in the format's filling room; [LobbyHandleNeeded] without a handle. */
    suspend fun join(format: LobbyFormat): LobbySeat

    /** GET /lobbies/{id}: the room's settings, seats, board and socket, for a drafter seated in it. */
    suspend fun lobby(id: String): LobbyRoom

    /** POST /lobbies/{id}/leave: the seat given up (a filling room frees it, a drafting room hands it to its
     * stand-in). */
    suspend fun leave(id: String)

    /** GET /lobbies/{id}/card: our call at the turn on the clock, as in the solo room. */
    suspend fun card(id: String): RoomCard

    /** GET /lobbies/{id}/report: the finished lobby's report for the caller's seat. */
    suspend fun report(id: String): MockReport

    /** PATCH /me: the handle the room shows the other drafters; the API's sentence when it refuses one. */
    suspend fun setHandle(handle: String)
}

/** The calls through the generated client. */
class ApiLobbyReads(
    private val transport: Transport,
) : LobbyReads {
    private val rooms get() = transport.rooms()

    override suspend fun lobbies(): List<LobbyFilling> = rooms.listLobbies().data()

    override suspend fun join(format: LobbyFormat): LobbySeat =
        try {
            rooms.joinLobby(LobbyJoin(format)).data()
        } catch (e: ApiFailure) {
            throw e.fields[HANDLE]?.let(::LobbyHandleNeeded) ?: e
        }

    override suspend fun lobby(id: String): LobbyRoom = rooms.getLobby(uuid(id)).data()

    override suspend fun leave(id: String) = rooms.leaveLobby(uuid(id)).done()

    override suspend fun card(id: String): RoomCard = rooms.lobbyCard(uuid(id)).data()

    override suspend fun report(id: String): MockReport = rooms.lobbyReport(uuid(id)).data()

    override suspend fun setHandle(handle: String) {
        try {
            transport.auth().updateMe(AccountUpdate(handle)).done()
        } catch (e: ApiFailure) {
            throw e.fields[HANDLE]?.let { ApiFailure(e.status, e.code, it, e.fields) } ?: e
        }
    }

    /** An answer whose data is null (EmptyResponse): only whether the API took it. */
    private suspend fun HttpResponse<*>.done() {
        val envelope = CommishJson.decodeFromString(Envelope.serializer(JsonElement.serializer()), bodyText())
        val error = envelope.error
        if (!envelope.ok || error != null) {
            throw ApiFailure(status, error?.code ?: "unknown", error?.message.orEmpty(), error?.fields.orEmpty())
        }
    }

    /** A room's id; one that is no uuid (a hand-made link) is a room the account holds no seat in. */
    private fun uuid(id: String): UUID =
        try {
            UUID.fromString(id)
        } catch (e: IllegalArgumentException) {
            throw ApiFailure(HTTP_NOT_FOUND, "not_found", e.message.orEmpty())
        }

    private companion object {
        const val HANDLE = "handle"
        const val HTTP_NOT_FOUND = 404
    }
}

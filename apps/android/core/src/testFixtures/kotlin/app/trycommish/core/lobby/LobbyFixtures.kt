package app.trycommish.core.lobby

import app.trycommish.api.ApiFailure
import app.trycommish.api.Unauthorized
import app.trycommish.api.decodeEnvelope
import app.trycommish.api.models.LobbyFilling
import app.trycommish.api.models.LobbyFormat
import app.trycommish.api.models.LobbyRoom
import app.trycommish.api.models.LobbySeat
import app.trycommish.api.models.MockReport
import app.trycommish.api.models.RoomCard
import app.trycommish.core.room.RoomFrame
import app.trycommish.core.room.RoomRow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.io.File
import java.time.Instant

/**
 * The recorded lobby (shared/fixtures/lobby-room, api/tools/lobbyrecord), the iOS LobbyFixture's: three drafters
 * in a 12_ppr lobby against a local API and room service, every answer the API's envelope as it answered, and
 * every frame the recorded drafter's socket sent and received.
 */
object LobbyFixtures {
    /** The recorded room's id, as every answer names it. */
    const val ID = "02294fd3-7304-4129-9071-1e7d95b4a4d5"

    /** The recorded drafter's seat. */
    const val YOU = 9

    private val folder = File(System.getProperty("fixtures"), "lobby-room")

    fun body(file: String): String = File(folder, "$file.json").readText()

    /** The room while it fills, or once drafted. */
    fun room(complete: Boolean = false): LobbyRoom = decodeEnvelope(body(if (complete) "room-complete" else "room-filling"))

    fun lobbies(): List<LobbyFilling> = decodeEnvelope(body("lobbies"))

    fun seat(): LobbySeat = decodeEnvelope(body("join"))

    /** Our call on the recorded drafter's turn at that overall pick (9, 16, 33, 40), null off them. */
    fun card(pick: Int): RoomCard? = File(folder, "card-$pick.json").takeIf { it.exists() }?.let { decodeEnvelope<RoomCard>(it.readText()) }

    /** A seat's report: hunt (the recorded drafter, 7th of 12), jpk88 (1st), mara (9th). */
    fun report(handle: String = "hunt"): MockReport = decodeEnvelope(body("report-$handle"))

    /** One step of the recorded socket: a frame the drafter sent, or one the room sent as its JSON text. */
    sealed interface Step {
        data class Client(
            val frame: JsonObject,
        ) : Step

        data class Server(
            val text: String,
        ) : Step
    }

    /** The recorded socket's frames, in order. */
    fun steps(): List<Step> =
        Json
            .parseToJsonElement(body("exchange"))
            .jsonObject
            .getValue("steps")
            .jsonArray
            .map { element ->
                val step = element.jsonObject
                step["client"]?.let { Step.Client(it.jsonObject) } ?: Step.Server(step.getValue("server").toString())
            }

    /** Each server frame's rows with the frame's index in the exchange. */
    fun frames(): List<Pair<Int, List<RoomRow>>> =
        steps().mapIndexedNotNull { index, step ->
            val text = (step as? Step.Server)?.text ?: return@mapIndexedNotNull null
            when (val frame = RoomFrame.decode(text)) {
                is RoomFrame.Welcome -> index to frame.rows
                is RoomFrame.Update -> index to frame.rows
                is RoomFrame.Error, null -> null
            }
        }

    /** The state after the frame at `index`, replayed from the room's read as the page applies it. */
    fun replayed(through: Int = Int.MAX_VALUE): LobbyState {
        val room = room()
        return frames().filter { it.first <= through }.fold(LobbyState.of(room)) { state, (_, rows) -> state.applying(rows, room.you) }
    }

    /** The parity file the web wrote over this lobby (shared/fixtures/parity/lobby.json). */
    fun parity(): String = File(System.getProperty("fixtures"), "parity/lobby.json").readText()

    /** The phone's clock the socket tests read the welcome by. */
    val phone: Instant = Instant.parse("2026-10-26T08:15:00.712Z")
}

/**
 * The lobby's reads over the recorded lobby, the iOS StubLobby's: the list, a join answering the recorded seat (or
 * asking for a handle first), the room, its cards by pick and the reports; `refusal` refuses the room's read with
 * a status (401, 403, 404) from the `refusalFrom`th read on. Records what was asked.
 */
class StubLobby(
    private var needsHandle: Boolean = false,
) : LobbyReads {
    val joins = mutableListOf<String>()
    val handles = mutableListOf<String>()
    var reads = 0
        private set
    var leaves = 0
        private set
    var cards = 0
        private set
    var refusal: Int? = null
    var refusalFrom = 1
    var complete = false
    var cardPick = LobbyFixtures.YOU

    override suspend fun lobbies(): List<LobbyFilling> = LobbyFixtures.lobbies()

    override suspend fun join(format: LobbyFormat): LobbySeat {
        joins += format.value
        if (needsHandle) throw LobbyHandleNeeded("Pick a handle first")
        return LobbyFixtures.seat()
    }

    override suspend fun lobby(id: String): LobbyRoom {
        reads++
        refusal?.takeIf { reads >= refusalFrom }?.let { throw refused(it) }
        return LobbyFixtures.room(complete)
    }

    override suspend fun leave(id: String) {
        leaves++
        refusal?.let { throw refused(it) }
    }

    override suspend fun card(id: String): RoomCard {
        cards++
        return LobbyFixtures.card(cardPick) ?: throw ApiFailure(HTTP_CONFLICT, "conflict", "No card for this pick.")
    }

    override suspend fun report(id: String): MockReport = LobbyFixtures.report()

    override suspend fun setHandle(handle: String) {
        handles += handle
        needsHandle = false
    }

    private fun refused(status: Int): Exception = if (status == HTTP_UNAUTHORIZED) Unauthorized() else ApiFailure(status, "refused", "")

    private companion object {
        const val HTTP_CONFLICT = 409
        const val HTTP_UNAUTHORIZED = 401
    }
}

package app.trycommish.core.lobby

import app.trycommish.api.models.LobbyRoom
import app.trycommish.api.models.LobbySeatView
import app.trycommish.core.companion.PlacedPick
import app.trycommish.core.room.RoomRow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeParseException

/** Who holds a seat (web/src/lib/room/lobby.ts SeatKind): a drafter, a bot, a drafter who left and whose
 * stand-in drafts, or a seat nobody holds yet. */
enum class LobbySeatKind(
    val wire: String,
) {
    Drafter("drafter"),
    Bot("bot"),
    Left("left"),
    Open("open"),
}

/** A seat as the log's replay names it: the drafter's handle (kept after he leaves) and who holds it. */
data class LobbySeatState(
    val handle: String?,
    val kind: LobbySeatKind,
)

/** Who made a pick: a drafter's own hand, a bot, a stand-in for a drafter who left, an expired clock. */
enum class LobbyPickBy(
    val wire: String,
) {
    Drafter("drafter"),
    Bot("bot"),
    Queue("queue"),
    Clock("clock"),
    ;

    companion object {
        fun of(wire: String?): LobbyPickBy = entries.firstOrNull { it.wire == wire } ?: Bot
    }
}

/** A pick in the lobby's log (lobby.ts LobbyPick): the pick, its round and seat, whom it took, who made it. */
data class LobbyPick(
    val pick: Int,
    val round: Int,
    val seat: Int,
    val playerId: String,
    val madeBy: LobbyPickBy,
) {
    val placed: PlacedPick get() = PlacedPick(pick, round, seat, playerId)
}

/**
 * A lobby as its log replays on the phone (lobby.ts LobbyState), the iOS LobbyState's: who sits where, every
 * pick with who made it, the pick on the clock and when its clock runs out on the room's clock, your queue.
 * Built from the room's own rows, so a reconnect that sends the rows since the last seq brings the screen to
 * exactly where the room is; never from a local guess.
 */
data class LobbyState(
    val seq: Long,
    val seats: Map<Int, LobbySeatState>,
    val picks: List<LobbyPick>,
    /** The pick on the clock, 1 until the draft starts. */
    val pickNumber: Int,
    /** When the turn on the clock runs out, on the room's clock. */
    val deadline: Instant?,
    val drafting: Boolean,
    val complete: Boolean,
    /** The room closed before it drafted: nobody was here when it filled. */
    val abandoned: Boolean,
    val soloPace: Boolean,
    /** Your queue, best first, as the room last stored it. */
    val queue: List<String>,
) {
    /** The players the log's picks took. */
    val drafted: Set<String> get() = picks.map { it.playerId }.toSet()

    /** lobby.ts applyActions: the log's rows applied in seq order; a row already applied is passed over. */
    fun applying(
        rows: List<RoomRow>,
        you: Int,
    ): LobbyState =
        rows.sortedBy { it.seq }.fold(this) { state, row ->
            if (row.seq <= state.seq) state else state.copy(seq = row.seq).applyingOne(row, you)
        }

    private fun withSeat(
        seat: Int,
        kind: LobbySeatKind,
        handle: (String?) -> String? = { it },
    ): LobbyState {
        val current = seats[seat] ?: LobbySeatState(null, LobbySeatKind.Open)
        return copy(seats = seats + (seat to LobbySeatState(handle(current.handle), kind)))
    }

    /** A seat's row: joined, left (freed while the room fills), returned; null for any other row. */
    private fun seated(row: RoomRow): LobbyState? {
        val payload = row.payload
        val seat = row.seat
        return when (row.kind) {
            "SEAT_JOINED" -> seat?.let { s -> withSeat(s, LobbySeatKind.Drafter) { payload.text("handle") } } ?: this
            "SEAT_LEFT" ->
                seat?.let { s -> withSeat(s, if (payload.flag("freed") == true) LobbySeatKind.Open else LobbySeatKind.Left) }
                    ?: this
            "SEAT_RETURNED" -> seat?.let { s -> withSeat(s, LobbySeatKind.Drafter) } ?: this
            else -> null
        }
    }

    private fun applyingOne(
        row: RoomRow,
        you: Int,
    ): LobbyState {
        seated(row)?.let { return it }
        val payload = row.payload
        return when (row.kind) {
            "ROOM_STARTED" ->
                payload.numbers("bots").fold(copy(soloPace = payload.flag("solo_pace") == true)) { state, bot ->
                    state.withSeat(bot, LobbySeatKind.Bot) { null }
                }
            "START_DRAFT" -> copy(pickNumber = 1, deadline = deadline(payload), drafting = true)
            "SET_QUEUE" -> {
                val action = payload.at("action")
                val mine = row.seat == you || action.text("teamId") == team(you)
                if (mine) copy(queue = action.texts("playerIds")) else this
            }
            "MAKE_PICK", "TIMER_EXPIRE" ->
                pick(payload.at("pick"))?.let { copy(picks = picks + it, pickNumber = it.pick + 1, deadline = deadline(payload)) }
                    ?: this
            "ROOM_ABANDONED" -> copy(deadline = null, drafting = false, abandoned = true)
            "ROOM_COMPLETE" -> copy(deadline = null, drafting = false, complete = true)
            else -> this
        }
    }

    companion object {
        /** lobby.ts initialLobby: the room before its first row, its status from the room's read. */
        fun of(room: LobbyRoom): LobbyState =
            LobbyState(
                seq = 0,
                seats = emptyMap(),
                picks = emptyList(),
                pickNumber = 1,
                deadline = null,
                drafting = false,
                complete = room.status == LobbyRoom.Status.complete,
                abandoned = room.status == LobbyRoom.Status.abandoned,
                soloPace = room.soloPace,
                queue = emptyList(),
            )

        private const val TEAM_DIGITS = 10

        /** lobby.ts teamOf: the engine's team id for a seat, "seat04". */
        fun team(seat: Int): String = "seat" + (if (seat < TEAM_DIGITS) "0$seat" else seat.toString())

        private fun deadline(payload: JsonElement?): Instant? = roomInstant(payload.text("deadline"))

        private fun pick(value: JsonElement?): LobbyPick? {
            val pick = value.int("pick") ?: return null
            val round = value.int("round") ?: return null
            val seat = value.int("seat") ?: return null
            val player = value.text("player_id") ?: return null
            return LobbyPick(pick, round, seat, player, LobbyPickBy.of(value.text("by")))
        }
    }
}

/** An instant the room wrote, in UTC ("2026-10-26T08:30:55.497Z") or at an offset ("...-05:00", as a room's
 * fill deadline is); null when there is none or it does not read. */
internal fun roomInstant(text: String?): Instant? =
    text?.let {
        try {
            OffsetDateTime.parse(it).toInstant()
        } catch (e: DateTimeParseException) {
            null
        }
    }

private fun JsonElement?.at(key: String): JsonElement? = (this as? JsonObject)?.get(key)

private fun JsonElement?.primitive(key: String): JsonPrimitive? = at(key) as? JsonPrimitive

private fun JsonElement?.text(key: String): String? = primitive(key)?.takeIf { it.isString }?.contentOrNull

private fun JsonElement?.flag(key: String): Boolean? = primitive(key)?.takeUnless { it.isString }?.booleanOrNull

private fun JsonElement?.int(key: String): Int? = primitive(key)?.takeUnless { it.isString }?.intOrNull

private fun JsonElement?.numbers(key: String): List<Int> =
    (at(key) as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeUnless { p -> p.isString }?.intOrNull }

private fun JsonElement?.texts(key: String): List<String> =
    (at(key) as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.contentOrNull }

/** The lobby's readers over its seats (lobby.ts): a seat's name, the people in it, who made a pick. */
object LobbySeats {
    /** lobby.ts seatName: You, a drafter's handle (kept after he leaves), Seat N while nobody holds it, or Bot N. */
    fun name(
        seat: Int,
        state: LobbySeatState?,
        you: Int,
    ): String {
        if (seat == you) return LobbyWords.YOU
        val held = state ?: LobbySeatState(null, LobbySeatKind.Open)
        if (held.kind == LobbySeatKind.Open) return LobbyWords.seat(seat)
        if (held.kind == LobbySeatKind.Bot) return LobbyWords.bot(seat)
        return held.handle ?: LobbyWords.bot(seat)
    }

    /** The API's seat list in the same words (the report's names). */
    fun name(
        view: LobbySeatView,
        you: Int,
    ): String = name(view.seat, LobbySeatState(view.handle, kind(view)), you)

    fun kind(view: LobbySeatView): LobbySeatKind = LobbySeatKind.entries.firstOrNull { it.wire == view.kind.value } ?: LobbySeatKind.Open

    /** lobby.ts seatedPeople: everyone who held a seat when it started, here or gone with a stand-in. */
    fun people(kinds: Collection<LobbySeatKind>): Int = kinds.count { it == LobbySeatKind.Drafter || it == LobbySeatKind.Left }

    /** lobby.ts pickCredit: who made a pick in the strip's words, a stand-in's credit on two lines. */
    fun credit(
        pick: LobbyPick,
        seats: Map<Int, LobbySeatState>,
        you: Int,
    ): List<String> {
        val owner = if (pick.seat == you) LobbyWords.YOU_CREDIT else seats[pick.seat]?.handle ?: LobbyWords.bot(pick.seat)
        return when (pick.madeBy) {
            LobbyPickBy.Drafter -> listOf(owner)
            LobbyPickBy.Queue -> listOf(LobbyWords.BOT_FOR, owner)
            LobbyPickBy.Clock -> listOf(LobbyWords.CLOCK_FOR, owner)
            LobbyPickBy.Bot -> listOf(LobbyWords.bot(pick.seat))
        }
    }
}

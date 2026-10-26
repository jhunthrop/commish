package app.trycommish.core.room

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.format.DateTimeParseException

/** One row of the room's log (openapi.yaml `RoomAction`): its seq, its kind, the seat it is about and its
 * payload as the room sent it (an object whose shape depends on the kind, kept whole so a reader takes what it
 * needs), and when it was written. */
data class RoomRow(
    val seq: Long,
    val kind: String,
    val seat: Int?,
    val payload: JsonElement,
    val written: String,
)

/** A frame the room sends (openapi.yaml `RoomWelcome`, `RoomUpdate`, `RoomError`). */
sealed interface RoomFrame {
    /** The answer to the hello: every row after the hello's seq, the room's latest seq, its clock. */
    data class Welcome(
        val seq: Long,
        val now: Instant,
        val rows: List<RoomRow>,
    ) : RoomFrame

    /** A batch of new rows, in seq order. */
    data class Update(
        val seq: Long,
        val rows: List<RoomRow>,
    ) : RoomFrame

    /** A refusal in the room's own words. */
    data class Error(
        val code: String,
        val message: String,
    ) : RoomFrame

    companion object {
        /** The frame in a text message; null for a type this client does not know (a newer room's), which is
         * skipped, never a reason to drop the socket. Throws [RoomFrameError] only for text that is not a frame
         * at all, or a welcome or an update missing what it must carry. */
        fun decode(text: String): RoomFrame? {
            val wire =
                try {
                    Json.parseToJsonElement(text) as? JsonObject
                } catch (e: SerializationException) {
                    throw RoomFrameError("not JSON", e)
                } ?: throw RoomFrameError("not an object")
            return when (val type = wire.text("type")) {
                "welcome" -> {
                    val seq = wire.long("seq") ?: throw RoomFrameError("a welcome without its seq")
                    val now = wire.text("now")?.let(::instantOrNull) ?: throw RoomFrameError("a welcome without its clock")
                    Welcome(seq, now, rows(wire))
                }
                "update" -> Update(wire.long("seq") ?: throw RoomFrameError("an update without its seq"), rows(wire))
                "error" -> Error(wire.text("code").orEmpty(), wire.text("message").orEmpty())
                else -> null.also { RoomSocket.log("skipped a frame of type $type") }
            }
        }

        private fun rows(wire: JsonObject): List<RoomRow> =
            (wire["actions"] as? JsonArray).orEmpty().map { element ->
                val row = element.jsonObject
                RoomRow(
                    seq = row.long("seq") ?: throw RoomFrameError("a row without its seq"),
                    kind = row.text("kind").orEmpty(),
                    seat = (row["seat"] as? JsonPrimitive)?.intOrNull,
                    payload = row["payload"] ?: JsonNull,
                    written = row.text("at").orEmpty(),
                )
            }

        private fun instantOrNull(text: String): Instant? =
            try {
                Instant.parse(text)
            } catch (e: DateTimeParseException) {
                null
            }
    }
}

/** Text from the room that is no frame at all. */
class RoomFrameError(
    what: String,
    cause: Throwable? = null,
) : Exception(what, cause)

/** A frame the client sends after its hello (openapi.yaml `RoomCommand`), its JSON with the keys in order. */
sealed interface RoomCommand {
    val text: String

    /** The player and the overall pick the drafter saw on the clock, so a stale pick is refused. */
    data class Pick(
        val playerId: String,
        val pick: Int,
    ) : RoomCommand {
        override val text: String
            get() = frame("pick" to JsonPrimitive(pick), "player_id" to JsonPrimitive(playerId), "type" to JsonPrimitive("pick"))
    }

    /** The whole queue, best first, at most 50; empty clears it. */
    data class Queue(
        val playerIds: List<String>,
    ) : RoomCommand {
        override val text: String
            get() = frame("player_ids" to JsonArray(playerIds.map(::JsonPrimitive)), "type" to JsonPrimitive("queue"))
    }

    /** Give the seat up. */
    data object Leave : RoomCommand {
        override val text: String get() = frame("type" to JsonPrimitive("leave"))
    }

    companion object {
        /** The hello with the last seq applied, 0 for none. */
        fun hello(lastSeq: Long): String = frame("last_seq" to JsonPrimitive(lastSeq), "type" to JsonPrimitive("hello"))

        private fun frame(vararg fields: Pair<String, JsonElement>): String = JsonObject(sortedMapOf(*fields)).toString()
    }
}

private fun JsonObject.text(key: String): String? = (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

private fun JsonObject.long(key: String): Long? = (get(key) as? JsonPrimitive)?.longOrNull

/** The array or none. */
private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()

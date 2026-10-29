package app.trycommish.api

import app.trycommish.api.models.ImportSkip
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.modules.SerializersModule
import kotlinx.serialization.modules.contextual
import java.math.BigDecimal
import java.util.UUID

/** A uuid as the API writes it, a string. The generated types mark it contextual. */
private object UuidSerializer : KSerializer<UUID> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("UUID", PrimitiveKind.STRING)

    override fun serialize(
        encoder: Encoder,
        value: UUID,
    ) = encoder.encodeString(value.toString())

    override fun deserialize(decoder: Decoder): UUID = UUID.fromString(decoder.decodeString())
}

/** A number the schema leaves without a format (the run's figures: 344.1, a tier's drop), read as the
 * API wrote it with no binary rounding on the way in. The generated types mark it contextual. */
private object BigDecimalSerializer : KSerializer<BigDecimal> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("BigDecimal", PrimitiveKind.DOUBLE)

    override fun serialize(
        encoder: Encoder,
        value: BigDecimal,
    ) = (encoder as? JsonEncoder)?.encodeJsonElement(JsonPrimitive(value)) ?: encoder.encodeDouble(value.toDouble())

    override fun deserialize(decoder: Decoder): BigDecimal =
        (decoder as? JsonDecoder)
            ?.decodeJsonElement()
            ?.jsonPrimitive
            ?.content
            ?.let(::BigDecimal)
            ?: BigDecimal(decoder.decodeDouble().toString())
}

/** The one JSON configuration every answer is read with: a field this build does not know is skipped,
 * so the API can add fields without breaking an app already in members' hands. */
val CommishJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        serializersModule =
            SerializersModule {
                contextual(UuidSerializer)
                contextual(BigDecimalSerializer)
            }
    }

/** The JSON a request's body is written with: a field the schema requires and the app holds as null is
 * sent as null (a lineup change into a spot left empty sends `"out": null`), never left out. A field
 * with a default the app did not set is still left out. */
val CommishRequestJson: Json = Json(CommishJson) { explicitNulls = true }

/** The API's error as the envelope carries it: its code, its sentence, the sentence per field it
 * refused, where it names one (a move's spent token says so under `confirm`), and the lines an import
 * skipped with their reasons when it read no player (Lane 297; absent from every other error). */
@Serializable
data class EnvelopeError(
    val code: String,
    val message: String,
    val fields: Map<String, String>? = null,
    val skipped: List<ImportSkip>? = null,
)

/** Every answer's envelope: ok, the data, the error. The request id and page meta are not read. */
@Serializable
data class Envelope<T>(
    val ok: Boolean,
    val data: T? = null,
    val error: EnvelopeError? = null,
)

/** The API answered with an error envelope, or with no data: its sentence, the sentence per field it
 * refused, and the lines an import skipped when it read no player (null when the error carries none). */
class ApiFailure(
    val status: Int,
    val code: String,
    override val message: String,
    val fields: Map<String, String> = emptyMap(),
    val skipped: List<ImportSkip>? = null,
) : Exception(message)

/** The API refused the device's token (401): it lapsed unused or was revoked. The app signs the
 * device out and asks for a sign-in, never "no connection". */
class Unauthorized : Exception("The API no longer accepts this device's sign-in.")

/** The envelope's data from an answer's body, or the API's failure. */
inline fun <reified T> decodeEnvelope(
    body: String,
    status: Int = HTTP_OK,
): T {
    if (status == HTTP_UNAUTHORIZED) throw Unauthorized()
    val envelope = CommishJson.decodeFromString<Envelope<T>>(body)
    val error = envelope.error
    if (!envelope.ok || error != null) {
        throw ApiFailure(
            status,
            error?.code ?: "unknown",
            error?.message ?: "The API answered with no data.",
            error?.fields.orEmpty(),
            error?.skipped,
        )
    }
    return envelope.data ?: throw ApiFailure(status, "empty", "The API answered with no data.")
}

const val HTTP_OK = 200
const val HTTP_UNAUTHORIZED = 401

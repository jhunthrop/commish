package app.trycommish.api

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.modules.SerializersModule
import kotlinx.serialization.modules.contextual
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

/** The one JSON configuration every answer is read with: a field this build does not know is skipped,
 * so the API can add fields without breaking an app already in members' hands. */
val CommishJson: Json =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        serializersModule = SerializersModule { contextual(UuidSerializer) }
    }

/** The API's error as the envelope carries it. */
@Serializable
data class EnvelopeError(
    val code: String,
    val message: String,
)

/** Every answer's envelope: ok, the data, the error. The request id and page meta are not read. */
@Serializable
data class Envelope<T>(
    val ok: Boolean,
    val data: T? = null,
    val error: EnvelopeError? = null,
)

/** The API answered with an error envelope, or with no data. */
class ApiFailure(
    val status: Int,
    val code: String,
    override val message: String,
) : Exception(message)

/** The envelope's data from an answer's body, or the API's failure. */
inline fun <reified T> decodeEnvelope(
    body: String,
    status: Int = HTTP_OK,
): T {
    val envelope = CommishJson.decodeFromString<Envelope<T>>(body)
    val error = envelope.error
    if (!envelope.ok || error != null) {
        throw ApiFailure(status, error?.code ?: "unknown", error?.message ?: "The API answered with no data.")
    }
    return envelope.data ?: throw ApiFailure(status, "empty", "The API answered with no data.")
}

const val HTTP_OK = 200

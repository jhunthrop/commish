package app.trycommish.core

import java.time.Instant
import java.time.format.DateTimeParseException

/** An instant the API wrote ("2026-10-18T17:00:00.000Z"), null when there is none or it does not read. */
fun instantOrNull(text: String?): Instant? =
    text?.let {
        try {
            Instant.parse(it)
        } catch (e: DateTimeParseException) {
            null
        }
    }

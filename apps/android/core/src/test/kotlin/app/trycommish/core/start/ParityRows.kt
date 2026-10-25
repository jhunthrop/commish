package app.trycommish.core.start

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// The parity files' readers every screen's parity test shares: a field as text, a row's cells in one
// order from the web's JSON and from the port (box.ts BoxRow as lineup-parity.ts writes it).

internal fun JsonObject.text(key: String): String? = (get(key) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content

internal fun JsonObject.int(key: String): Int = getValue(key).jsonPrimitive.int

internal fun JsonObject.strings(key: String): List<String> = getValue(key).jsonArray.map { it.jsonPrimitive.content }

internal fun JsonObject.rows(key: String): List<List<Any?>> = getValue(key).jsonArray.map { rowOf(it.jsonObject) }

/** A row's cells in one order, from the web's JSON. */
internal fun rowOf(row: JsonObject): List<Any?> {
    val status = (row["status"] as? JsonObject)?.let { listOf(it.text("mark"), it.getValue("sits").jsonPrimitive.boolean) }
    val weather = (row["weather"] as? JsonObject)?.let { listOf(it.text("glyph"), it.text("words")) }
    return listOf(
        row.text("key"),
        row.text("slot"),
        row.text("move"),
        row.getValue("idle").jsonPrimitive.boolean,
        row.text("name"),
        row.text("fit"),
        row.text("slug"),
        row.text("club"),
        row.text("position"),
        status,
        row.text("rank"),
        gameOf(row["game"]),
        row.text("note"),
        row.text("expected"),
        weather,
        row.text("proj"),
        row.text("pts"),
        row.text("evidence"),
        row.text("oppRank"),
        row.text("ease"),
        row.text("state"),
        row.text("why"),
    )
}

internal fun gameOf(game: JsonElement?): Any? =
    when (game) {
        null, JsonNull -> null
        is JsonPrimitive -> game.content
        is JsonObject -> listOf(game.text("where"), game.text("when"))
        is JsonArray -> error("a game is never a list")
    }

/** The same cells from the port. */
internal fun rowOf(cells: RowCells): List<Any?> {
    val row = cells.row
    val game =
        when (val g = cells.game) {
            is RowGame.Game -> listOf(g.place, g.time)
            RowGame.Bye -> "bye"
            RowGame.NoClub -> "no-club"
            RowGame.None -> null
        }
    return listOf(
        row.id,
        row.slot,
        cells.move?.word,
        cells.idle,
        row.name,
        row.fit,
        row.slug,
        row.club,
        row.position,
        row.status?.let { listOf(it.mark, it.sits) },
        cells.rank,
        game,
        cells.note,
        row.expected,
        row.weather?.let { listOf(it.glyph, it.words) },
        cells.proj,
        cells.pts,
        cells.evidence,
        cells.oppRank,
        cells.ease.word,
        row.read.stateName,
        cells.why,
    )
}

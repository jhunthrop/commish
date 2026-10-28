package app.trycommish.core.sheet

/**
 * A CSV read on the phone before it is sent (a port of web/src/lib/sheet/csv.ts decodeCsv, the iOS SheetCSV,
 * held to shared/fixtures/parity/sheet.json `reads`): the header must name rank, player_id, name and
 * position in any order and case, a bad row is skipped with its reason, and the players kept are counted.
 * The import sends nothing the web's panel would not let replace a sheet: a file whose header cannot be
 * used is refused with its sentence, and one that reads no player with what it skipped. A list of names is not
 * read here: the API reads it (Lane 278). The web's reasons
 * say "line" where the phone says "row" (SheetWords).
 */
object SheetCsv {
    /** The header could not be used: the web's (and the API's) sentence. */
    class HeaderError(
        override val message: String,
    ) : Exception(message)

    /** A row skipped: the file's row as the API numbers it (the header is row 1), and why. */
    data class Skip(
        val row: Int,
        val reason: String,
    )

    /** The players a file reads as, in rank order, and the rows it skipped. */
    data class Read(
        val ids: List<String>,
        val skipped: List<Skip>,
    )

    private val columns = listOf("rank", "player_id", "name", "position", "team", "tier", "tags", "note")
    private val required = listOf("rank", "player_id", "name", "position")
    private val aliases = mapOf("tag" to "tags")
    private val positions = listOf("QB", "RB", "WR", "TE", "K", DEFENSE)
    private val positionAliases = mapOf("DEF" to DEFENSE, "D/ST" to DEFENSE, DEFENSE to DEFENSE, "PK" to "K")
    private val formulaLead = setOf('=', '+', '-', '@', '\t', '\r')

    /** A comma, a bar, and the semicolon, named by its code: the copy rules keep the mark out of words. */
    private val tagSeparators = charArrayOf(',', '|', SEMICOLON.toChar())

    /** The byte-order mark a header may open with, named by its code. */
    private val byteOrderMark = BYTE_ORDER_MARK_CODE.toChar()

    /** A decimal number for a trimmed cell, as the web's Number reads a decimal ("1.0" and "1e0" are 1). A
     * hex cell, which Number also takes, is refused here as the API's integer read (strconv.Atoi) refuses
     * it, and Java's suffixes ("1d") are never a number. The API refuses "1.0" too (Lane 267 review M3, the
     * API's to settle). */
    private val decimal = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")

    /** True when the text is the sheet's CSV, not a list of names: its first line names player_id (paste.ts
     * looksLikeCsv, the API's looksLikeCSV, held to sheet.json `lists`). */
    fun looksLikeCsv(text: String): Boolean =
        text
            .trimStart { it.isWhitespace() || it == byteOrderMark }
            .lineSequence()
            .first()
            .lowercase()
            .contains("player_id")

    /** The file read as the web reads it; throws [HeaderError] when the header cannot be used. */
    fun read(text: String): Read {
        val (records, unterminated) = records(text)
        val header = records.firstOrNull() ?: throw HeaderError(SheetWords.emptyFile)
        val index = headerIndex(header)
        val body = records.drop(1)
        val kept = mutableListOf<Kept>()
        val skipped = mutableListOf<Skip>()
        val seen = mutableSetOf<String>()
        body.forEachIndexed { offset, record ->
            val line = offset + 2
            val refusal =
                when {
                    unterminated && offset == body.size - 1 -> SheetWords.notCsv
                    else -> refusal(record, index)
                }
            val id = cell(record, index, "player_id")
            when {
                refusal != null -> skipped += Skip(line, refusal)
                id in seen -> skipped += Skip(line, SheetWords.earlier)
                kept.size >= SheetLimits.ROWS -> skipped += Skip(line, SheetWords.tooMany)
                else -> {
                    seen += id
                    kept += Kept(number(cell(record, index, "rank")) ?: 0.0, line, id)
                }
            }
        }
        val ordered = kept.sortedWith(compareBy<Kept> { it.rank }.thenBy { it.line })
        return Read(ordered.map { it.id }, skipped.toList())
    }

    /** A player kept, with where he was in the file, which breaks a tie in rank. */
    private data class Kept(
        val rank: Double,
        val line: Int,
        val id: String,
    )

    /** Records of an RFC 4180 file (parseRecords); a quote left open runs to the end and is reported. */
    internal fun records(text: String): Pair<List<List<String>>, Boolean> {
        val reader = RecordReader()
        var cursor = 0
        while (cursor < text.length) {
            val next = text.getOrNull(cursor + 1)
            cursor += if (reader.take(text[cursor], next)) 2 else 1
        }
        return reader.finish()
    }

    /** parseRecords' loop, one character at a time. */
    private class RecordReader {
        private val records = mutableListOf<List<String>>()
        private var record = mutableListOf<String>()
        private val field = StringBuilder()
        private var quoted = false
        private var fieldStart = true

        private fun endField() {
            record += field.toString()
            field.clear()
            fieldStart = true
        }

        /** The character read; true when it took the next one with it (a doubled quote, CRLF). */
        fun take(
            char: Char,
            next: Char?,
        ): Boolean {
            if (quoted) return takeQuoted(char, next)
            when {
                char == '"' && fieldStart -> {
                    quoted = true
                    fieldStart = false
                }
                char == ',' -> endField()
                char == '\n' || char == '\r' -> {
                    endField()
                    if (!(record.size == 1 && record[0].isEmpty())) records += record.toList()
                    record = mutableListOf()
                    return char == '\r' && next == '\n'
                }
                // A read trims leading space, as the API's does, at a field's start only.
                (char == ' ' || char == '\t') && fieldStart && field.isEmpty() -> Unit
                else -> {
                    field.append(char)
                    fieldStart = false
                }
            }
            return false
        }

        private fun takeQuoted(
            char: Char,
            next: Char?,
        ): Boolean {
            if (char == '"' && next == '"') {
                field.append('"')
                return true
            }
            if (char == '"') quoted = false else field.append(char)
            return false
        }

        fun finish(): Pair<List<List<String>>, Boolean> {
            if (field.isNotEmpty() || record.isNotEmpty()) {
                endField()
                records += record.toList()
            }
            return records.toList() to quoted
        }
    }

    private fun headerIndex(header: List<String>): Map<String, Int> {
        val index = mutableMapOf<String, Int>()
        header.forEachIndexed { column, raw ->
            val name = raw.replace(byteOrderMark.toString(), "").trim().lowercase()
            val known = aliases[name] ?: columns.firstOrNull { it == name }
            if (known != null && known !in index) index[known] = column
        }
        if (!required.all { it in index }) throw HeaderError(SheetWords.badHeader)
        return index.toMap()
    }

    private fun cell(
        record: List<String>,
        index: Map<String, Int>,
        column: String,
    ): String {
        val place = index[column] ?: return ""
        return undefuse(record.getOrNull(place)?.trim().orEmpty())
    }

    private fun undefuse(value: String): String =
        if (value.length > 1 && value[0] == '\'' && value[1] in formulaLead) value.substring(1) else value

    /** JavaScript's Number over a trimmed cell: empty is 0, anything else a decimal or nothing. */
    private fun number(text: String): Double? =
        when {
            text.isEmpty() -> 0.0
            decimal.matches(text) -> text.toDoubleOrNull()
            else -> null
        }

    private fun whole(value: Double?): Boolean = value != null && value.isFinite() && Math.rint(value) == value

    private fun lengthProblem(
        label: String,
        value: String,
        min: Int,
        max: Int,
    ): String? {
        val length = value.codePointCount(0, value.length)
        return if (length < min || length > max) SheetWords.length(label, min, max) else null
    }

    private fun position(raw: String): String? {
        val upper = raw.trim().uppercase()
        return positionAliases[upper] ?: positions.firstOrNull { it == upper }
    }

    /** Why a tags cell cannot be read, or null (readTags). */
    private fun tagsProblem(raw: String): String? {
        val pieces = raw.split(*tagSeparators).map { it.trim() }.filter { it.isNotEmpty() }
        var tags = emptyList<String>()
        for (piece in pieces) {
            val tag = SheetTags.canonical(piece)
            SheetTags.problem(tag)?.let { return it }
            if (!SheetTags.has(tags, tag)) tags = tags + tag
        }
        return when {
            tags.size > SheetLimits.TAGS -> SheetWords.full
            SheetTags.normalized(tags).size < tags.size -> SheetWords.bothTargetAndAvoid
            else -> null
        }
    }

    /** Why a record cannot be a player, or null when it can (readRow). */
    private fun refusal(
        record: List<String>,
        index: Map<String, Int>,
    ): String? {
        val rank = number(cell(record, index, "rank"))
        if (!whole(rank) || (rank ?: 0.0) < 1) return SheetWords.badRank
        lengthProblem("player_id", cell(record, index, "player_id"), 1, SheetLimits.PLAYER_ID)?.let { return it }
        lengthProblem("name", cell(record, index, "name"), 1, SheetLimits.PLAYER_NAME)?.let { return it }
        lengthProblem("team", cell(record, index, "team"), 0, SheetLimits.TEAM)?.let { return it }
        lengthProblem("note", cell(record, index, "note"), 0, SheetLimits.NOTE)?.let { return it }
        if (position(cell(record, index, "position")) == null) return SheetWords.badPosition
        val rawTier = cell(record, index, "tier")
        if (rawTier.isNotEmpty()) {
            val tier = number(rawTier)
            if (!whole(tier) || (tier ?: 0.0) < 1 || (tier ?: 0.0) > SheetLimits.TIER) return SheetWords.badTier
        }
        return tagsProblem(cell(record, index, "tags"))
    }

    private const val SEMICOLON = 0x3B
    private const val BYTE_ORDER_MARK_CODE = 0xFEFF
}

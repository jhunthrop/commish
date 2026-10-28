package app.trycommish.core.sheet

/** The sheet's bounds (web/src/lib/sheet/limits.ts SHEET_LIMITS, the API's validate.go and tags.go, the
 * iOS SheetLimits), held to shared/fixtures/parity/sheet.json. */
object SheetLimits {
    const val ROWS = 1000
    const val SHEET_NAME = 60
    const val PLAYER_ID = 64
    const val PLAYER_NAME = 80
    const val TEAM = 8
    const val TIER = 50
    const val NOTE = 500
    const val TAGS = 4
    const val TAG_LENGTH = 20
    const val HEADSHOT = 300

    /** The largest CSV an import takes (csv.ts CSV_MAX_BYTES, the API's maxSheetBody). */
    const val CSV_BYTES = 1 shl 20
}

/** How a tag is drawn (tags.ts tagTone): yours in your color, Avoid in the loss tone, so it never reads as
 * a pick. */
enum class TagTone(
    val id: String,
) {
    You("you"),
    Loss("loss"),
}

/** A tag as a row prints it: its word and its tone. */
data class TagMark(
    val label: String,
    val tone: TagTone,
)

/** A fixed tag: its stored spelling and the word its chip prints. */
data class FixedTag(
    val tag: String,
    val label: String,
)

/**
 * Tags: the fixed set the API names plus the drafter's own words (a port of web/src/lib/sheet/tags.ts, the
 * iOS SheetTags, held to shared/fixtures/parity/sheet.json). A tag is trimmed with its inner spaces closed
 * up, a word that spells a fixed tag in any case is that tag, no tag appears twice in any case, Target and
 * Avoid never sit on one row, and a row holds at most four.
 */
object SheetTags {
    /** The fixed tags in the order the sheet offers them. */
    val fixed: List<FixedTag> =
        listOf(
            FixedTag("target", "Target"),
            FixedTag("sleeper", "Sleeper"),
            FixedTag("breakout", "Breakout"),
            FixedTag("avoid", "Avoid"),
            FixedTag("injury", "Injury"),
            FixedTag("handcuff", "Handcuff"),
        )

    private const val TARGET = "target"
    private const val AVOID = "avoid"

    /** Tags that contradict each other: a row holds the one chosen last. */
    private val opposites = mapOf(TARGET to AVOID, AVOID to TARGET)

    /** Letters, digits, spaces, apostrophes, periods and hyphens, starting with a letter or digit. */
    private val ownTag = Regex("^[\\p{L}\\p{N}][\\p{L}\\p{N} '’.-]*$")
    private val spaces = Regex("(?U)\\s+")

    fun isFixed(tag: String): Boolean = fixed.any { it.tag == tag }

    /** The tag in its stored spelling. */
    fun canonical(raw: String): String {
        val tag = raw.split(spaces).filter { it.isNotEmpty() }.joinToString(" ")
        return fixed.firstOrNull { it.tag == tag.lowercase() }?.tag ?: tag
    }

    /** Why a tag cannot be used, or null when it can (tagProblem). */
    fun problem(tag: String): String? {
        val length = tag.codePointCount(0, tag.length)
        val shaped = ownTag.matches(tag)
        return if (length in 1..SheetLimits.TAG_LENGTH && shaped) null else SheetWords.tagShape
    }

    fun same(
        a: String,
        b: String,
    ): Boolean = a.lowercase() == b.lowercase()

    fun has(
        tags: List<String>,
        tag: String,
    ): Boolean = tags.any { same(it, tag) }

    /** Canonical, valid, each once, never with its opposite, at most four, first ones kept. */
    fun normalized(raw: List<String>): List<String> =
        raw.fold(emptyList()) { out, candidate ->
            val tag = canonical(candidate)
            val clash = out.any { same(it, tag) || it == opposites[tag] }
            if (problem(tag) != null || clash || out.size >= SheetLimits.TAGS) out else out + tag
        }

    /** A tap on a tag: off when it is on, otherwise on in place of its opposite; null when the row is full
     * and the tag cannot go on (toggledTags). */
    fun toggled(
        tags: List<String>,
        raw: String,
    ): List<String>? {
        val tag = canonical(raw)
        if (has(tags, tag)) return tags.filterNot { same(it, tag) }
        val rest = tags.filter { it != opposites[tag] }
        return if (rest.size < SheetLimits.TAGS) normalized(rest + tag) else null
    }

    /** The word a chip prints for a tag. */
    fun label(tag: String): String = fixed.firstOrNull { it.tag == tag }?.label ?: tag

    fun tone(tag: String): TagTone = if (canonical(tag) == AVOID) TagTone.Loss else TagTone.You

    fun marks(tags: List<String>): List<TagMark> = tags.map { TagMark(label(it), tone(it)) }

    /** Every tag a sheet uses that is not a fixed one, in first-seen order: the drafter's own set. */
    fun own(lists: List<List<String>>): List<String> =
        lists.flatten().fold(emptyList()) { out, tag -> if (isFixed(tag) || has(out, tag)) out else out + tag }
}

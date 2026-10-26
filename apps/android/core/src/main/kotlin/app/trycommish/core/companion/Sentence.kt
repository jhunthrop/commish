package app.trycommish.core.companion

/** web/src/lib/format/sentence.ts firstSentence (the iOS Sentence): the first sentence of the advisor's
 * why, the reason; the sentences after it restate the chances the figure beside it already prints. */
object Sentence {
    /** Words a period follows without ending a sentence: "The No. 3 receiver", "Amon-Ra St. Brown". */
    private val abbreviations = setOf("No", "St", "Jr", "Sr", "Mr", "vs", "Jan", "Feb")
    private val stops = setOf('.', '!', '?')
    private const val OPEN_QUOTE = '“'

    fun first(text: String): String {
        val end = text.indices.firstOrNull { text[it] in stops && ends(text, it) } ?: return text
        return text.substring(0, end + 1)
    }

    /** Whether the stop at `index` ends a sentence: not after an abbreviation or a lone initial ("D.J."),
     * and followed by the end or by a space and a capital, a digit or a quote. */
    private fun ends(
        text: String,
        index: Int,
    ): Boolean {
        val word = text.substring(0, index).takeLastWhile { it.isAsciiLetter() }
        if (word in abbreviations || (word.length == 1 && word[0].isUpperCase())) return false
        val after = text.substring(index + 1)
        if (after.isEmpty()) return true
        val rest = after.trimStart()
        val next = rest.firstOrNull() ?: return false
        if (rest.length == after.length) return false
        return (next.code < ASCII && (next.isUpperCase() || next.isDigit())) || next == '"' || next == OPEN_QUOTE
    }

    private fun Char.isAsciiLetter(): Boolean = code < ASCII && isLetter()

    private const val ASCII = 128
}

package app.trycommish.core.reference

import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunIndexEntry
import app.trycommish.api.models.RunManifest
import app.trycommish.core.board.BoardBasis
import app.trycommish.core.board.BoardCells
import app.trycommish.core.board.BoardChip
import app.trycommish.core.board.RunWords
import app.trycommish.core.liveorder.LiveOrder
import app.trycommish.core.liveorder.LiveOrderWords
import app.trycommish.core.liveorder.LivePlace
import app.trycommish.core.liveorder.OrderAtClock
import app.trycommish.core.shell.SheetPlayer
import app.trycommish.core.shell.initialsOf
import app.trycommish.design.Words
import java.text.Normalizer
import java.time.ZoneId

/** A player the compare's search can set on a side: who he is, as the run's index names him. */
data class CompareCandidate(
    val id: String,
    val slug: String,
    val name: String,
    /** "WR · LAR". */
    val line: String,
    /** search.ts folded: lower case, accents folded. */
    val key: String,
)

/** A side of Compare as its picker shows it: the player set on it, a link's slug that names nobody (the
 * web's absent words over the search), or nobody yet. */
sealed interface CompareSlot {
    data class Picked(
        val name: String,
        val initials: String,
        val headshot: String?,
    ) : CompareSlot

    data object Missing : CompareSlot

    data object Open : CompareSlot
}

/** A side's head over the table: his face, name, pill and club, his sheet. */
data class CompareHead(
    val id: String,
    val name: String,
    val initials: String,
    val headshot: String?,
    /** "WR 4". */
    val pill: String,
    val club: String,
    val sheetPlayer: SheetPlayer,
    /** His floor, median and ceiling where the run carries them. */
    val range: CompareRange?,
)

/** The pair's shared scale for the range bars. */
data class CompareScale(
    val low: Double,
    val high: Double,
)

/** The table once both sides are in: the call and its evidence, the heads, the rows, the range scale and
 * the basis. */
data class CompareTable(
    val call: String,
    val evidence: String,
    val heads: List<CompareHead>,
    val rows: List<CompareRow>,
    /** Null where neither side carries a range. */
    val scale: CompareScale?,
    val basis: List<String>,
)

/** What Compare shows under the pickers: nothing until both sides are in, the same player twice, or the
 * call with its table. */
sealed interface CompareOutcome {
    data object None : CompareOutcome

    data class Same(
        val title: String,
        val line: String,
    ) : CompareOutcome

    data class Table(
        val table: CompareTable,
    ) : CompareOutcome
}

/** A side as the screen's address set it: nobody, a slug that names nobody, or a player. */
sealed interface CompareFound {
    data object Open : CompareFound

    data object Missing : CompareFound

    data class Player(
        val player: ComparePlayer,
    ) : CompareFound
}

/** Everything Compare is built from. */
data class CompareInput(
    val manifest: RunManifest,
    val format: RunFormat,
    val sources: List<RunAdpSource>,
    val clubs: List<RunClub>,
    val underway: Boolean,
    val reach: Reach,
    /** The format the season block is scored in, as its chip prints it. */
    val scoring: String,
    val index: List<RunIndexEntry>,
    val sides: List<CompareFound>,
    /** The member's zone, the clock the basis says its stamps on. */
    val zone: ZoneId,
    /** The order at the screen's clock, null while unread. */
    val order: OrderAtClock? = null,
) {
    /** The players set on the sides, by name, whose order a pair reads. */
    val names: List<String> get() = sides.mapNotNull { (it as? CompareFound.Player)?.player?.name }

    /** The order's places for the pair when the run ranks the rest of the season, the answer is in the
     * board's scoring and it places both in the board's own format, else none. */
    fun pairPlaces(ids: List<String>): Map<String, LivePlace>? {
        val board = manifest.formats.firstOrNull() ?: return null
        val read = order?.takeIf { format.rosFromWeek != null && LiveOrder.inScoring(it.answer, board) } ?: return null
        return LiveOrder.pair(ids, read.places, format.id, board.id)
    }
}

/**
 * Compare as the web's /compare says it at 390 (routes/(run)/compare): two players side by side in a
 * format, the leader's column first, from their pages (GET /run/players/{id}, a held page's copy or the
 * board's row as the web's reader falls back), the Bye row from the clubs, the basis under the table with
 * the last season's line; the format the followed league's where the run carries it, else the run's
 * default. In season the pair's rank, place, points and value are the order's once it places both in the
 * board's own format (Lane 226, placedPair), the order's lead in the board sentence's place; until then
 * both sides are the run's, the basis with the run's stamp.
 */
data class CompareModel(
    val title: String,
    /** firstStep: what to do while a side is empty; null once both are in. */
    val lead: String?,
    val formats: List<BoardChip<String>>,
    val format: String,
    val slots: List<CompareSlot>,
    /** Each slot's words over its search. */
    val slotLabels: List<String>,
    val outcome: CompareOutcome,
    val candidates: List<CompareCandidate>,
    /** The slugs set on each side, as the screen's address names them. */
    val slugs: List<String?>,
    /** Whether the pair's figures are the order's. */
    val atClock: Boolean = false,
) {
    /** search.ts searchPlayers: names starting with the query first, then a later word starting with it,
     * then anywhere in a word, each in the index's order (our rank); eight at most. */
    fun search(query: String): List<CompareCandidate> {
        val wanted = folded(query.trim())
        if (wanted.isEmpty()) return emptyList()
        return candidates
            .mapIndexedNotNull { order, candidate -> matchRank(candidate.key, wanted)?.let { Triple(it, order, candidate) } }
            .sortedWith(compareBy({ it.first }, { it.second }))
            .take(SEARCH_LIMIT)
            .map { it.third }
    }

    companion object {
        const val SEARCH_LIMIT = 8
        private val MARKS = Regex("\\p{M}+")
        private val WORD_BREAKS = Regex("[ .'-]")

        fun folded(text: String): String = Normalizer.normalize(text, Normalizer.Form.NFD).replace(MARKS, "").lowercase()

        private fun matchRank(
            key: String,
            query: String,
        ): Int? =
            when {
                key.startsWith(query) -> 0
                key.split(WORD_BREAKS).any { it.isNotEmpty() && it.startsWith(query) } -> 1
                key.contains(query) -> 2
                else -> null
            }

        /** compare-words.ts firstStep. */
        fun firstStep(picked: Int): String? =
            when {
                picked <= 0 -> "Pick two players to see which one we would take, with their figures side by side."
                picked == 1 -> "Pick a second player to set beside the first."
                else -> null
            }

        /** Each side in the compared format with his club's bye, null for one not set; at the order's clock
         * both with the order's figures once it places the pair (placedPair), and whether it does. */
        private fun sides(input: CompareInput): Pair<List<CompareSide?>, Boolean> {
            val format = input.format
            val byes = BoardCells.byes(input.clubs)
            val run =
                input.sides.map { found ->
                    val player = (found as? CompareFound.Player)?.player ?: return@map null
                    val numbers = player.formats[format.id] ?: return@map null
                    CompareSide(player, numbers, byes[player.team])
                }
            val picked = run.filterNotNull()
            if (picked.size != 2) return run to false
            val places = input.pairPlaces(picked.map { it.player.id }) ?: return run to false
            val placed =
                run.map { side ->
                    side?.let { places[it.player.id]?.let { place -> it.copy(numbers = it.numbers.at(place, format.teams)) } ?: it }
                }
            return placed to true
        }

        fun of(input: CompareInput): CompareModel {
            val format = input.format
            val (sides, atClock) = sides(input)
            val both = sides.filterNotNull()
            return CompareModel(
                title = Words.ComparePage.title,
                lead = firstStep(both.size),
                formats = input.manifest.formats.map { BoardChip(it.label, it.id, it.id == format.id) },
                format = format.id,
                slots =
                    input.sides.zip(sides).map { (found, side) ->
                        when {
                            side != null -> CompareSlot.Picked(side.player.name, initialsOf(side.player.name), side.player.headshot)
                            found == CompareFound.Missing -> CompareSlot.Missing
                            else -> CompareSlot.Open
                        }
                    },
                slotLabels = listOf(Words.ComparePage.firstPlayer, Words.ComparePage.secondPlayer),
                outcome = outcome(both, input, atClock),
                atClock = atClock,
                candidates =
                    input.index.map { entry ->
                        CompareCandidate(entry.id, entry.slug, entry.name, "${entry.position.value} · ${entry.team}", folded(entry.name))
                    },
                slugs = input.sides.map { (it as? CompareFound.Player)?.player?.slug },
            )
        }

        private fun outcome(
            both: List<CompareSide>,
            input: CompareInput,
            atClock: Boolean,
        ): CompareOutcome {
            if (both.size != 2) return CompareOutcome.None
            return when (val verdict = Verdict.between(both[0], both[1], input.format.label)) {
                Verdict.Same -> CompareOutcome.Same(Words.ComparePage.sameTitle, Words.Verdict.samePlayer)
                is Verdict.Call -> {
                    val rows =
                        CompareRows.rows(
                            verdict.leader,
                            verdict.other,
                            input.manifest.season,
                            input.underway,
                            input.format.rosFromWeek,
                        )
                    val gapRow = rows.any { it.label == CompareRows.GAP_LABEL }
                    val ranges = listOf(verdict.leader, verdict.other).mapNotNull { it.numbers.range }
                    CompareOutcome.Table(
                        CompareTable(
                            call = verdict.call,
                            evidence = verdict.evidence,
                            heads = listOf(verdict.leader, verdict.other).map(::head),
                            rows = rows,
                            scale = if (ranges.isEmpty()) null else CompareScale(ranges.minOf { it.floor }, ranges.maxOf { it.ceiling }),
                            basis = clocked(basis(input).filter { gapRow || !it.second }.map { it.first }, input, atClock),
                        ),
                    )
                }
            }
        }

        private fun head(side: CompareSide): CompareHead {
            val player = side.player
            val rank = player.heldRank ?: side.numbers.positionRank.toString()
            return CompareHead(
                id = player.id,
                name = player.name,
                initials = initialsOf(player.name),
                headshot = player.headshot,
                pill = "${player.position} $rank",
                club = player.team,
                sheetPlayer =
                    SheetPlayer(
                        player.id,
                        player.slug,
                        player.name,
                        player.position,
                        rank,
                        player.team,
                        player.headshot,
                        player.id,
                    ),
                range = side.numbers.range,
            )
        }

        /** The basis on the pair's clock: the order's lead in the board sentence's place, or in season the
         * compared format's run stamp after the whole basis (basisAtClock). */
        private fun clocked(
            run: List<String>,
            input: CompareInput,
            atClock: Boolean,
        ): List<String> {
            val format = input.format
            if (format.rosFromWeek == null) return run
            return LiveOrder.basis(
                run,
                BoardBasis.ourBoard(format, input.manifest.season),
                input.order?.takeIf { atClock }?.lead(format.teams, input.zone),
                LiveOrderWords.runStamp(format, input.zone),
            )
        }

        /** compare/+page.server.ts: the board's basis in the format, every part on the phone, the season's
         * reach once it is underway, then the last season's line; each part with whether it is the Gap's. */
        fun basis(input: CompareInput): List<Pair<String, Boolean>> {
            val format = input.format
            val drafts = RunWords.adpDrafts(input.sources, format.id).joinToString(" and ")
            val parts = mutableListOf(BoardBasis.ourBoard(format, input.manifest.season) to false)
            if (format.rosFromWeek == null) {
                parts += "ADP from $drafts." to false
                parts += Words.BoardBasis.gap to true
            }
            if (input.underway) {
                val scoring = if (input.scoring == format.label) "" else ", scored in ${input.scoring}"
                val through = SeasonReach.words(input.reach)
                parts += "GP and ${Words.Figure.avg} are this season's$scoring${if (through.isEmpty()) "" else ", $through"}." to false
            }
            parts += "${input.manifest.season - 1} a game is last season's points a game." to false
            return parts
        }
    }
}

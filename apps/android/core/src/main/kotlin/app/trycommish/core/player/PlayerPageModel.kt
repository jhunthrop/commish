package app.trycommish.core.player

import app.trycommish.api.models.LeagueHost
import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.ProjectionScoring
import app.trycommish.api.models.RunAdpSource
import app.trycommish.api.models.RunBoardAnswer
import app.trycommish.api.models.RunBoardRow
import app.trycommish.api.models.RunClub
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunHeldCopy
import app.trycommish.api.models.RunIndexEntry
import app.trycommish.api.models.RunManifest
import app.trycommish.api.models.RunPlayer
import app.trycommish.api.models.RunSchedule
import app.trycommish.core.Format
import app.trycommish.core.board.BoardFigures
import app.trycommish.core.board.BoardStatus
import app.trycommish.core.board.Heat
import app.trycommish.core.board.RunWords
import app.trycommish.core.instantOrNull
import app.trycommish.core.liveorder.LiveOrderWords
import app.trycommish.core.shell.FollowedLeague
import app.trycommish.core.shell.headshotOf
import app.trycommish.core.shell.initialsOf
import app.trycommish.core.shell.unreadBasis
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.RowStatus
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/**
 * The player page from the run, in the web's order (web/src/routes/(run)/players/[slug] over
 * server/pages/player.ts at 390): the card (his face, name, club, pill and status, the next game with its
 * expected score and weather, the six tiles), the club and status footnotes and the league line, before
 * the season the facts (where drafters take him, Over replacement, his range), his season (the game log,
 * Still to play, earlier seasons), our read, his tier box or the held tier, the every-format table, the
 * basis lines, and the verb the league's screens give him. Pure: the view decides nothing.
 */
data class PlayerPageModel(
    val hero: Hero,
    /** The card: the next game and the six tiles (its read and basis are the page's own sections). */
    val card: PlayerCard,
    /** The footnotes under the card (B165): his newest game's club, then his status with its capture. */
    val notes: List<String>,
    /** The line about the figures' scoring against the selected league's, null with none selected. */
    val leagueLine: String?,
    val facts: Facts?,
    val season: SeasonView,
    /** null for a page held back with no copy: its basis says once that our read is not written. */
    val read: Read?,
    /** In place of his tier for a player on a season-long list: "On IR, not ranked". */
    val heldTier: String?,
    val tier: TierBox?,
    val formats: FormatsTable?,
    /** Every number's basis, once: the week's, then the season's. */
    val basis: List<String>,
    val verb: CardVerb?,
    /** The run's stamp the page is from: the earlier run's for a held page's copy. */
    val stamp: String,
) {
    data class Hero(
        val name: String,
        val initials: String,
        val headshot: String?,
        /** "Chicago Bears", a free agent's "FA". */
        val club: String,
        /** "WR 25", or with a season-long list its word, "QB IR". */
        val pill: String,
        val status: RowStatus?,
    )

    /** A fact (Fact.svelte): its label, its figure and the sentence under it. */
    data class Fact(
        val label: String,
        val figure: String,
        val unit: String?,
        val words: String,
    )

    data class Outcomes(
        val label: String,
        val floor: Double,
        val median: Double,
        val ceiling: Double,
        val caption: String,
    )

    /** The facts the page shows before the season only, as the web does. */
    data class Facts(
        val drafters: Fact,
        val overReplacement: Fact,
        val heat: Heat,
        val outcomes: Outcomes?,
    )

    /** Our read as the page shows it: in season the week's read or the words for none written; before the
     * season the writer's capsule as written, or the words for none ready with what it will be built from. */
    sealed interface Read {
        data class Week(
            val shown: ShownRead,
        ) : Read

        data class WeekNone(
            val words: String,
        ) : Read

        data class Prose(
            val paragraphs: List<String>,
            val byline: String?,
            val figures: List<ReadFigure>,
        ) : Read

        data class Unwritten(
            val words: String,
            val lines: List<UnwrittenLine>,
        ) : Read
    }
}

/** His page as read: his own, an earlier run's copy of a held one with that run's stamp, or for a held page
 * with no copy the board's figures alone. */
sealed interface PageSource {
    data class Page(
        val player: RunPlayer,
    ) : PageSource

    data class Copy(
        val player: RunPlayer,
        val from: RunHeldCopy,
    ) : PageSource

    data class Facts(
        val entry: RunIndexEntry,
        val row: RunBoardRow,
    ) : PageSource

    val page: RunPlayer?
        get() =
            when (this) {
                is Page -> player
                is Copy -> player
                is Facts -> null
            }
}

/** Everything the page is built from, read from the run's routes and the week. */
data class PageInput(
    val source: PageSource,
    val manifest: RunManifest,
    val sources: List<RunAdpSource>,
    val capture: RunDesignations?,
    val clubs: List<RunClub>,
    val schedule: RunSchedule,
    /** The leading format's board, null where it was not read: its size and his tier. */
    val board: RunBoardAnswer?,
    /** His week, the league's with its verb where one is followed; null where it could not be read. */
    val week: PlayerWeek?,
    /** The platform his week was read on, null where it was read with no league. */
    val host: LeagueHost?,
    /** The league the shell shows, for the league line; null with none. */
    val league: FollowedLeague?,
    val zone: ZoneId,
    val now: Instant,
) {
    val boardSize: Int? get() = board?.let { it.rows.size + it.market.size }
}

object PlayerPages {
    /** The page, null where no format of the run ranks him. */
    fun page(input: PageInput): PlayerPageModel? {
        val who = Who.of(input.source)
        val (format, numbers) = lead(input) ?: return null
        val listed = input.capture?.players?.get(who.id)
        val status = listed?.let { BoardStatus.view(it, input.zone) }
        val underway = underway(input)
        val season = season(input, who, format)
        val card = card(input, format, numbers.projected, status?.rank)
        val player = input.source.page
        val rankRead = rankRead(input, format)
        val live = PageSections.liveFormats(input.week, format)
        val formats =
            player?.let {
                PageSections.formats(
                    PageSections.lines(it, input.manifest.formats),
                    FormatsFacts(who.position, status?.rank, live, rankRead),
                )
            }
        // The run's stamp while the every-format table shows the run's ranks and figures in season (the
        // web's Lane 234): on game day the run and the read share a date, so its time says the clock.
        val runStamp = LiveOrderWords.runStamp(format, input.zone).takeIf { formats != null && live == null }
        return PlayerPageModel(
            hero =
                PlayerPageModel.Hero(
                    name = who.name,
                    initials = initialsOf(who.name),
                    headshot = headshotOf(who.headshot),
                    club = PageWords.clubName(who.team, input.clubs),
                    pill = "${who.position} ${status?.rank ?: (rankRead?.positionRank ?: numbers.positionRank).toString()}",
                    status = status,
                ),
            card = card.first,
            notes = notes(input, who, format),
            leagueLine = input.league?.let { PageNotes.league(it.host, it.scoring, it.format, CardTiles.apiFormatOf(format)) },
            facts = if (underway) null else facts(input, format, numbers, listed?.seasonLong == true),
            season = season,
            read = player?.let { read(input, it, underway, format, status?.rank) },
            heldTier = listed?.takeIf { it.seasonLong }?.let { PageWords.heldTier(it.status) },
            tier = input.board?.let { PageSections.tier(it, who.id, format, input.manifest.season, input.capture) },
            formats = formats,
            basis = card.second + listOfNotNull(runStamp, season.basis),
            verb = verb(input),
            stamp = stamp(input),
        )
    }

    /** His place at his position as his week's read places him once the lead format ranks the rest of the
     * season: the head's and the every-format table's one rank (Lane 226, the web's head and lineRanksAt);
     * null before the season or with no read. */
    private fun rankRead(
        input: PageInput,
        format: RunFormat,
    ): RankRead? {
        val week = input.week ?: return null
        return if (format.rosFromWeek == null) null else RankRead(CardTiles.apiFormatOf(format), week.line.positionRank)
    }

    /** The footnotes under the card (B165): the club line from his page, then the status note where the
     * capture lists him. */
    private fun notes(
        input: PageInput,
        who: Who,
        format: RunFormat,
    ): List<String> {
        val club = input.source.page?.let { PageNotes.club(it.team, it.lastGameClub, input.clubs) }
        val capture = input.capture
        val status =
            capture?.players?.get(who.id)?.let {
                PageNotes.status(it, capture, format.rosFromWeek != null, input.zone, input.now)
            }
        return listOfNotNull(club, status)
    }

    /** The format the page leads with, the first of the run's that ranks him, and his numbers in it. */
    internal fun lead(input: PageInput): Pair<RunFormat, LineNumbers>? =
        when (val source = input.source) {
            is PageSource.Facts ->
                input.manifest.formats
                    .firstOrNull()
                    ?.let { it to LineNumbers.of(source.row) }
            else -> {
                val player = source.page ?: return null
                input.manifest.formats.firstNotNullOfOrNull { format -> player.formats[format.id]?.let { format to LineNumbers.of(it) } }
            }
        }

    /** run.ts seasonUnderway: the run was written at or after the season's first kickoff. */
    fun underway(input: PageInput): Boolean {
        val first =
            input.schedule.slates
                .flatMap { it.games }
                .mapNotNull { instantOrNull(it.kickoff) }
                .minOrNull() ?: return false
        val runAt = instantOrNull(input.manifest.runAt) ?: return false
        return !runAt.isBefore(first)
    }

    /** Each week's last kickoff on the run's schedule. */
    private fun lastKickoff(
        schedule: RunSchedule,
        week: Int,
    ): Instant? =
        schedule.slates
            .flatMap { it.games }
            .filter { it.week == week }
            .mapNotNull { instantOrNull(it.kickoff) }
            .maxOrNull()

    /** The card: his week's read over the page's build where the week answered (the sheet's card), the
     * build alone where it did not, with the basis the web says for an unread week. */
    internal fun card(
        input: PageInput,
        format: RunFormat,
        projected: Double,
        held: String?,
    ): Pair<PlayerCard, List<String>> {
        val week = input.week
        if (week != null) {
            val card =
                PlayerCards.card(
                    CardInput(week, input.source.page, format, input.capture, input.host != null, input.zone, input.now, projected),
                )
            return card.onPage to card.basis
        }
        val next = input.source.page?.let { PageSections.weekAhead(it.season) }
        val tiles = PageSections.builtTiles(input.source.page, format, next, projected)
        val basis = unreadBasis(failed = true, weekTile = tiles.first().label, listed = held)
        return PlayerCard(next, null, tiles, emptyList(), null, null, GameRead.NoGame) to listOf(basis)
    }

    private fun season(
        input: PageInput,
        who: Who,
        format: RunFormat,
    ): SeasonView =
        input.source.page?.let { SeasonViews.view(it, input.manifest.formats, input.schedule.slates) }
            ?: SeasonViews.held(input.manifest.season, who.position, format)

    private fun facts(
        input: PageInput,
        format: RunFormat,
        numbers: LineNumbers,
        heldOut: Boolean,
    ): PlayerPageModel.Facts {
        val words =
            PageWords.line(
                format,
                numbers,
                RunWords.adpDrafts(input.sources, format.id),
                input.boardSize,
                PageWords.Season(input.manifest.season, underway = false, heldOut = heldOut),
            )
        return PlayerPageModel.Facts(
            drafters = PlayerPageModel.Fact(words.draftersLabel, words.draftersFigure, null, words.drafters),
            overReplacement =
                PlayerPageModel.Fact(Words.PlayerPage.overReplacement, BoardFigures.signed(numbers.vor), format.unit, words.value),
            heat = Heat.of(numbers.vor, numbers.vorRound),
            outcomes = outcomes(numbers, format, input.manifest.season),
        )
    }

    private fun outcomes(
        numbers: LineNumbers,
        format: RunFormat,
        season: Int,
    ): PlayerPageModel.Outcomes? {
        val floor = numbers.floor ?: return null
        val median = numbers.median ?: return null
        val ceiling = numbers.ceiling ?: return null
        return PlayerPageModel.Outcomes(Words.PlayerPage.outcomes, floor, median, ceiling, PageWords.outcomesCaption(season, format.label))
    }

    /** In season the week's read beside the week's projection, the words for none written with none; before
     * the season the capsule as the writer wrote it, its paragraphs split by a blank line, or with none the
     * words for a read not ready and what it will be built from. */
    private fun read(
        input: PageInput,
        player: RunPlayer,
        underway: Boolean,
        format: RunFormat,
        held: String?,
    ): PlayerPageModel.Read {
        val state = input.week?.let { PlayerCards.readState(LineRead.game(it.line, input.now)) }
        if (underway) {
            // The newer of the run's read and the answer's live one (Lane 284).
            val read =
                WeekReads.newest(player.weekRead, input.week?.weekRead)
                    ?: return PlayerPageModel.Read.WeekNone(WeekReads.noRead(state, player.weekReadsDue, input.now))
            val shown = StatusHeld.read(read, input.capture, player.id, input.now)
            val card =
                input.week?.let {
                    CardProjection(it.week, it.projectionScoring.format == ProjectionScoring.Format.ppr, it.line.weekProjection, state)
                }
            return PlayerPageModel.Read.Week(WeekReads.shown(shown, card))
        }
        val capsule = player.capsule
        if (capsule == null) {
            val numbers = player.formats[format.id]
            val facts = PageSections.UnwrittenFacts(player.position.value, input.boardSize ?: 0, format, input.manifest.season, held)
            return PlayerPageModel.Read.Unwritten(Words.Unwritten.read, numbers?.let { PageSections.unwritten(it, facts) }.orEmpty())
        }
        val projected = player.formats[format.id]?.projected?.toDouble() ?: 0.0
        return PlayerPageModel.Read.Prose(
            paragraphs(capsule.body),
            PageWords.readStamp(capsule),
            ReadFigures.preseason(capsule.pulls, projected),
        )
    }

    /** Capsule.svelte: paragraphs split by a blank line, each trimmed, none empty. */
    internal fun paragraphs(body: String): List<String> {
        val groups = mutableListOf(mutableListOf<String>())
        body.split("\n").forEach { line -> if (line.isBlank()) groups += mutableListOf<String>() else groups.last() += line }
        return groups.map { it.joinToString("\n").trim() }.filter { it.isNotEmpty() }
    }

    private fun verb(input: PageInput): CardVerb? {
        val week = input.week ?: return null
        val host = input.host ?: return null
        return CardVerbs.pinned(week, host, lastKickoff(input.schedule, week.week), input.now)
    }

    /** run/stamp.ts: "Updated Oct 21", a held page's copy by its own run's day. */
    private fun stamp(input: PageInput): String {
        val source = input.source as? PageSource.Copy ?: return RunWords.stamp(input.manifest)
        val day = instantOrNull(source.from.runAt)?.let { Format.shortDay(it, RunWords.eastern) } ?: source.from.runAt
        return "${Words.RunStamp.updated} $day"
    }

    /** Who the page is of, from his page or the index. */
    internal data class Who(
        val id: String,
        val name: String,
        val team: String,
        val position: String,
        val headshot: String,
    ) {
        companion object {
            fun of(source: PageSource): Who =
                when (source) {
                    is PageSource.Facts -> source.entry.let { Who(it.id, it.name, it.team, it.position.value, it.headshot) }
                    is PageSource.Page -> source.player.who()
                    is PageSource.Copy -> source.player.who()
                }

            private fun RunPlayer.who(): Who = Who(id, name, team, position.value, headshot)
        }
    }
}

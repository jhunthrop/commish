package app.trycommish.core.player

import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.ProjectionScoring
import app.trycommish.api.models.RunDesignations
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunPlayer
import app.trycommish.api.models.RunWeekRead
import app.trycommish.api.models.WeekFacts
import app.trycommish.core.Format
import app.trycommish.core.instantOrNull
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.LineRead
import app.trycommish.core.start.RowGame
import app.trycommish.core.start.RowStatus
import app.trycommish.core.start.RowStatuses
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.WeatherCell
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** One of the card's figures as a cell (card.ts CardTile, its caption left to the basis lines): what it
 * is, the figure, and its tone. */
data class CardTile(
    val key: Key,
    val label: String,
    /** "21.8", "26th", or "--" without a figure. */
    val value: String,
    val tone: Tone?,
) {
    enum class Key(
        val id: String,
    ) {
        Proj("proj"),
        Rest("rest"),
        Opp("opp"),
        Avg("avg"),
        Last("last"),
        Delta("delta"),
    }

    /** card.ts TileTone: the accent for the week's figure, his opponent's ease, quiet for the change. */
    enum class Tone(
        val id: String,
    ) {
        Lead("lead"),
        Easy("easy"),
        Hard("hard"),
        Even("even"),
        Quiet("quiet"),
    }
}

/** The card's head (card.ts CardHead): the week the card shows and his game in it ("at NYJ", "Bye"). */
data class CardHead(
    val week: Int,
    val opponent: String,
) {
    /** CardNext.svelte's week: "Week 6". */
    val label: String get() = "${Words.Card.week} $week"
}

/** The week ahead's cell under his name (week-words.ts NextCell): "at ATL", "Sun 12:00 pm CT", then the
 * expected score and the weather while his game is still to be played. */
data class NextCell(
    val place: String,
    val time: String,
    val expected: String?,
    val weather: WeatherCell?,
)

/** His read's place on the sheet: the week's read as the shelf shows it, or with none written for him the
 * words that say so. */
sealed interface SheetRead {
    data class Shown(
        val read: ShownRead,
    ) : SheetRead

    data class None(
        val words: String,
    ) : SheetRead
}

/**
 * The sheet's body (the web's player shelf once his week is read, PlayerShelf.svelte over week-words.ts
 * liveCard and shelf.ts gameTiles): his game, the six figures as cells, the read, the basis lines once,
 * and his status from the week's line. Pure, held to shared/fixtures/parity/player-sheet.json.
 */
data class PlayerCard(
    /** null where the run holds no week ahead for him. */
    val head: CardHead?,
    val cell: NextCell?,
    val tiles: List<CardTile>,
    val basis: List<String>,
    /** null where his page could not be read: the shelf then draws no read. */
    val read: SheetRead?,
    /** His designation as the week's line has it ("Questionable", "IR since Sep 24"). */
    val status: RowStatus?,
    /** His game this week by the line's field, the one rule the tiles and the read follow. */
    val game: GameRead,
) {
    /** The card as the page draws it: its read, its basis and his status left to the page's own sections. */
    val onPage: PlayerCard get() = copy(basis = emptyList(), read = null, status = null)
}

/** What the card is built from: his week from the API, his page from the run (null where it cannot be
 * read) in the format the page leads with, the capture beside the run, whether the week was read in the
 * member's league, and the screen's clock and zone. */
data class CardInput(
    val week: PlayerWeek,
    val page: RunPlayer?,
    val format: RunFormat?,
    val capture: RunDesignations?,
    val league: Boolean,
    val zone: ZoneId,
    val now: Instant,
    /** His figure in the format where no page carries it (a held page's board row), else null. */
    val projected: Double? = null,
)

object PlayerCards {
    /** The card at the input's clock. */
    fun card(input: CardInput): PlayerCard {
        val line = input.week.line
        val game = LineRead.game(line, input.now)
        val status = RowStatuses.row(line.facts.designation, line.player.injuredReserve, game.toPlay, input.zone)
        val listed = status?.rank
        val read = input.page?.weekRead?.let { StatusHeld.read(it, input.capture, input.page.id, input.now) }
        val tiles = CardTiles.live(input, read, game)
        return PlayerCard(
            head = head(input, game),
            cell = cell(input, game, listed != null),
            tiles = CardTiles.played(CardTiles.listed(tiles, listed), game, line.facts.pointsThisWeek),
            basis = CardBasis.lines(input.week, input.league && input.week.verb != null, input.now, listed != null, read),
            read = sheetRead(input, read, game),
            status = status,
            game = game,
        )
    }

    /** The read as the shelf shows it beside the card's projection, the not-written words with none, and
     * nothing where his page could not be read. */
    internal fun sheetRead(
        input: CardInput,
        read: RunWeekRead?,
        game: GameRead,
    ): SheetRead? {
        if (input.page == null) return null
        val state = readState(game)
        if (read == null) return SheetRead.None(WeekReads.noRead(state, input.page.weekReadsDue, input.now))
        val week = input.week
        val card = CardProjection(week.week, week.projectionScoring.format == ProjectionScoring.Format.ppr, week.line.weekProjection, state)
        return SheetRead.Shown(WeekReads.shown(read, card))
    }

    /** His game's state as the read is judged by (kickoff.ts lineState): none on a bye or with no game,
     * and a state this build does not read held as none. */
    fun readState(game: GameRead): GameRead? =
        when (game) {
            GameRead.Upcoming, GameRead.KickedOff, GameRead.Final -> game
            GameRead.NoGame, is GameRead.Unread -> null
        }

    /** week-words.ts headOf: the API's week, and the game or the bye in it. */
    internal fun head(
        input: CardInput,
        game: GameRead,
    ): CardHead {
        val opponent =
            when (val row = StartRows.game(input.week.line, game, input.zone)) {
                is RowGame.Game -> row.place
                RowGame.Bye -> Words.Box.bye
                RowGame.NoClub -> Words.Box.noClub
                RowGame.None -> Words.Box.none
            }
        return CardHead(input.week.week, opponent)
    }

    /** week-words.ts nextOf: the expected score and the weather only while his game is still to be played
     * (and he is on no season-long list), the kickoff with its zone, "Kicked off" or "Final" after. */
    internal fun cell(
        input: CardInput,
        game: GameRead,
        listed: Boolean,
    ): NextCell? {
        val line = input.week.line
        val row = StartRows.game(line, game, input.zone) as? RowGame.Game ?: return null
        val ahead = game.toPlay && !listed
        val kickoff = if (game.toPlay) instantOrNull(line.facts.kickoff)?.let { Format.kickoffAt(it, input.zone) } else null
        return NextCell(
            place = row.place,
            time = kickoff ?: row.time,
            expected = if (ahead) expectedScore(line.facts, line.player.team) else null,
            weather = if (ahead) StartRows.weather(line.facts) else null,
        )
    }

    /** box.ts expectedScoreWords: "Expected score DET 28.5, GB 25", each club named. */
    internal fun expectedScore(
        facts: WeekFacts,
        club: String,
    ): String? {
        val total = facts.gameTotal ?: return null
        val opponent = facts.opponent ?: return null
        val theirs = total.points - total.teamPoints
        return "Expected score $club ${StartRows.halves(total.teamPoints)}, $opponent ${StartRows.halves(theirs)}"
    }
}

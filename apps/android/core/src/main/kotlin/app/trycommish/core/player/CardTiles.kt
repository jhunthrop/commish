package app.trycommish.core.player

import app.trycommish.api.models.PlayerAfterBye
import app.trycommish.api.models.PlayerLine
import app.trycommish.api.models.PlayerWeek
import app.trycommish.api.models.RunFormat
import app.trycommish.api.models.RunGameStatus
import app.trycommish.api.models.RunPlayer
import app.trycommish.api.models.RunWeekRead
import app.trycommish.core.Format
import app.trycommish.core.start.Ease
import app.trycommish.core.start.GameRead
import app.trycommish.core.start.StartRows
import app.trycommish.core.start.StartWords
import app.trycommish.design.Words

/** The card's six figures (web/src/lib/server/pages/player-card.ts cardBuild and restTile, the tiles as
 * built from his page; week-words.ts liveCard, the week's read over them; card.ts listedTiles and
 * shelf.ts gameTiles), as values and labels: their captions are the basis lines' to say once. */
internal object CardTiles {
    private val none = Words.Card.none

    /** format-ids.ts DEFAULT_TEAMS: the league size the API values a run format at. */
    private const val DEFAULT_TEAMS = 12

    /** The tiles once the week is read, in the card's order: Proj, Rest of season, Opp rank, Avg, Last
     * and the change. */
    fun live(
        input: CardInput,
        read: RunWeekRead?,
        game: GameRead,
    ): List<CardTile> {
        val week = input.week
        val built = builtTiles(input.page, input.format, input.projected)
        val after = if (week.line.facts.bye) week.afterBye else null
        return listOf(
            projTile(week),
            restTile(week, input.format, built.rest),
            after?.let(::afterByeOppTile) ?: oppTile(week.line),
            avgTile(week, built.avg),
            lastTile(week, built.last),
            after?.let(::afterByeProjTile) ?: deltaTile(week, read, game),
        )
    }

    /** card.ts listedTiles: a player on a season-long list ("IR") has his list in place of the week's Proj,
     * Opp rank and change. */
    fun listed(
        tiles: List<CardTile>,
        listed: String?,
    ): List<CardTile> {
        if (listed == null) return tiles
        return tiles.map { tile ->
            when (tile.key) {
                CardTile.Key.Proj, CardTile.Key.Opp -> tile.copy(value = none, tone = null)
                CardTile.Key.Delta -> tile.copy(value = none, tone = CardTile.Tone.Quiet)
                CardTile.Key.Rest, CardTile.Key.Avg, CardTile.Key.Last -> tile
            }
        }
    }

    /** shelf.ts gameTiles: his Pts in place of Proj once his game has kicked off, by the line's field. */
    fun played(
        tiles: List<CardTile>,
        game: GameRead,
        points: Double?,
    ): List<CardTile> {
        if (game != GameRead.KickedOff && game != GameRead.Final) return tiles
        return tiles.map { tile ->
            if (tile.key == CardTile.Key.Proj) tile.copy(label = Words.Box.pts, value = points?.let(::tenth) ?: none) else tile
        }
    }

    // The tiles as built from his page

    data class Built(
        val rest: CardTile,
        val avg: CardTile,
        val last: CardTile,
    )

    /** player-card.ts cardBuild and restTile: rest of season (or the season's projection on a preseason
     * board) in the page's format, Avg and Last from his season so far; "--" with no page. */
    fun builtTiles(
        page: RunPlayer?,
        format: RunFormat?,
        projected: Double? = null,
    ): Built {
        val figure = format?.let { page?.formats?.get(it.id) }?.projected?.toDouble() ?: projected
        val preseason = format != null && format.rosFromWeek == null
        val last =
            page
                ?.season
                ?.log
                ?.lastOrNull { it.status == RunGameStatus.played && it.points != null }
                ?.points
                ?.toDouble()
        return Built(
            rest =
                CardTile(
                    CardTile.Key.Rest,
                    if (preseason) Words.Card.projected else Words.Card.rest,
                    figure?.let { Format.fixed(it) } ?: none,
                    null,
                ),
            avg =
                CardTile(
                    CardTile.Key.Avg,
                    Words.Card.avg,
                    page?.season?.pointsPerGame?.let { Format.fixed(it.toDouble()) } ?: none,
                    null,
                ),
            last = CardTile(CardTile.Key.Last, Words.Card.last, last?.let { Format.fixed(it) } ?: none, null),
        )
    }

    // The week's tiles

    /** figure-words.ts weekHead: "Wk 6". */
    fun weekHead(week: Int): String = "${Words.Figure.week} $week"

    /** box.ts printTenth: the API's tenth as JavaScript prints it, "11.0" for a whole one. */
    fun tenth(value: Double): String = StartWords.number(value)

    private fun projTile(week: PlayerWeek): CardTile =
        CardTile(CardTile.Key.Proj, weekHead(week.week), week.line.weekProjection?.let(::tenth) ?: none, CardTile.Tone.Lead)

    /** The week's Rest of season: the read's figure in the page's format once the run ranks the rest of the
     * season (format-ids.ts apiFormatOf names the API's format), the page's as built otherwise. */
    private fun restTile(
        week: PlayerWeek,
        format: RunFormat?,
        fallback: CardTile,
    ): CardTile {
        if (format?.rosFromWeek == null) return fallback
        val board = apiFormatOf(format) ?: return fallback
        val figure = week.restOfSeason?.firstOrNull { it.format.value == board }
        return figure?.let { fallback.copy(value = tenth(it.points)) } ?: fallback
    }

    /** format-ids.ts apiFormatOf: the API's board format of a run format at the default league size, null
     * for another size. */
    fun apiFormatOf(format: RunFormat): String? {
        val suffix = "-$DEFAULT_TEAMS"
        if (format.teams != DEFAULT_TEAMS || !format.id.endsWith(suffix)) return null
        return format.id.dropLast(suffix.length).replace("-", "_")
    }

    private fun oppTile(line: PlayerLine): CardTile {
        val rank = line.oppRank ?: return CardTile(CardTile.Key.Opp, Words.Card.opp, none, null)
        return CardTile(CardTile.Key.Opp, Words.Card.opp, Format.ordinal(rank), tone(rank, line.facts.allowedToPosition?.of))
    }

    /** On his bye the opponent tile reads his next game's (Lane 100, B30). */
    private fun afterByeOppTile(after: PlayerAfterBye): CardTile = oppTile(after.line)

    private fun tone(
        rank: Int,
        clubs: Int?,
    ): CardTile.Tone =
        when (StartRows.ease(rank, clubs)) {
            Ease.Easy -> CardTile.Tone.Easy
            Ease.Hard -> CardTile.Tone.Hard
            Ease.Even -> CardTile.Tone.Even
        }

    private fun avgTile(
        week: PlayerWeek,
        fallback: CardTile,
    ): CardTile = week.line.seasonAvg?.let { fallback.copy(value = tenth(it)) } ?: fallback

    private fun lastTile(
        week: PlayerWeek,
        fallback: CardTile,
    ): CardTile {
        val last = week.line.lastPoints
        if (last == null ||
            week.line.facts.lastGames
                .isEmpty()
        ) {
            return fallback
        }
        return fallback.copy(value = tenth(last))
    }

    /** On his bye the change's tile gives his next game's Proj. */
    private fun afterByeProjTile(after: PlayerAfterBye): CardTile =
        CardTile(
            CardTile.Key.Delta,
            "${weekHead(after.week)} ${Words.Card.proj}",
            after.line.weekProjection?.let(::tenth) ?: none,
            CardTile.Tone.Quiet,
        )

    /** The change while his game is to come (or his bye), shown from the threshold; "--" once it has kicked
     * off, and for a free agent, who has no game. */
    private fun deltaTile(
        week: PlayerWeek,
        read: RunWeekRead?,
        game: GameRead,
    ): CardTile {
        val line = week.line
        if (line.player.team == Words.Figure.freeAgentClub || !(game.toPlay || line.facts.bye)) {
            return CardTile(CardTile.Key.Delta, Words.Card.delta, none, CardTile.Tone.Quiet)
        }
        val move = moveOf(week, read)
        return CardTile(
            CardTile.Key.Delta,
            Words.Card.delta,
            StartWords.delta(if (move.crosses) move.change else null),
            CardTile.Tone.Quiet,
        )
    }

    /** week-words.ts moveOf: from the read's quoted figure when a read was written for this week, else from
     * the earlier snapshot. */
    fun moveOf(
        week: PlayerWeek,
        read: RunWeekRead?,
    ): ProjectionMove {
        val quoted = read?.takeIf { it.week == week.week }?.let(QuotedProjection::of) ?: QuotedProjection.NotNamed
        return ProjectionMove.of(week.line.weekProjection, quoted, week.line.projectionDelta)
    }
}

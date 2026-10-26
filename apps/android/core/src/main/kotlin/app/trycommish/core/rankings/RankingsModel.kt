package app.trycommish.core.rankings

import app.trycommish.api.models.OrderAdvice
import app.trycommish.api.models.WeekOrderAdvice
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/** The order's heads: the # head, the week's ("Wk 6") and the big figure's (Projected). */
data class RankingsHeads(
    val rank: String,
    val week: String,
    val total: String,
)

/** Our order as the Rankings screen draws it (the web's Players page in season over OrderScreen.svelte
 * and OrderTable.svelte at 390): the sentence under the page's name, the search's hits, the heads, the
 * rows in their sections with each place the API's own, whether Show more is offered, the basis said
 * once. Pure over the API's answer, the clock and the zone. */
data class RankingsModel(
    val lead: String?,
    val hits: String,
    val heads: RankingsHeads,
    val sections: List<RankingsSection<RankingsRow>>,
    /** The API holds more rows than the read asked for. */
    val more: Boolean,
    val basis: String,
    /** "No player in our order matches." where a filter leaves none. */
    val none: String?,
    val week: Int,
) {
    /** Every row in its order. */
    val rows: List<RankingsRow> get() = sections.flatMap { it.rows }
}

fun rankingsModel(
    advice: OrderAdvice,
    chip: RankingsChip?,
    query: String,
    inSeason: Boolean,
    zone: ZoneId,
    now: Instant,
): RankingsModel {
    val viewing = OrderViewing(RankingsRows.rankBy(advice), advice.week, pillRank = chip == null)
    val rows = advice.rows.map { RankingsRows.row(it, viewing, zone, now) }
    val searched = query.trim().length >= OrderQuery.MIN_SEARCH
    return RankingsModel(
        lead = RankingsWords.lead(inSeason, onWeekChip = false, week = advice.week),
        hits = RankingsWords.hits(advice.total, filtered = searched || chip != null, onClub = advice.onClub),
        heads = RankingsHeads(Words.Order.rank, RankingsWords.weekHead(advice.week), Words.Order.total),
        sections = RankingsRows.sections(rows, advice.week),
        more = advice.total > advice.rows.size,
        basis = RankingsBasis.order(advice, zone, now),
        none = if (advice.total == 0) Words.Order.none else null,
        week = advice.week,
    )
}

/** The kickers' or defenses' week as the Rankings' K and D/ST chips draw it (WeekScreen.svelte and
 * WeekTable.svelte at 390, the basis line over the rows as the Players page says it): the status line
 * before the week's projection is in, the rows in their sections in the published projection's order,
 * the line when a search matches none, the basis with the rules our stats lack. */
data class WeekRankingsModel(
    val heading: String,
    val status: String?,
    /** The Proj column: drawn once a row has one. */
    val proj: Boolean,
    val sections: List<RankingsSection<WeekRankingsRow>>,
    val none: String?,
    val basis: String,
    val rules: String?,
    val week: Int,
) {
    val rows: List<WeekRankingsRow> get() = sections.flatMap { it.rows }
}

fun weekRankingsModel(
    advice: WeekOrderAdvice,
    position: WeekPosition,
    query: String,
    boardScoring: String,
    zone: ZoneId,
    now: Instant,
): WeekRankingsModel {
    val rows = advice.rows.map { it to RankingsRows.weekRow(it, zone, now) }
    val shown = rows.filter { (row, drawn) -> RankingsRows.matches(row, drawn, query) }
    return WeekRankingsModel(
        heading = RankingsWords.weekHeading(position, advice.week),
        status = RankingsWords.weekStatus(advice, position),
        proj = RankingsWords.landed(advice),
        sections = RankingsRows.weekSections(shown, advice.week, zone, now),
        none = if (shown.isEmpty() && rows.isNotEmpty()) RankingsWords.weekNone(position) else null,
        basis = RankingsBasis.week(advice, position, boardScoring, zone, now),
        rules = RankingsBasis.rules(advice),
        week = advice.week,
    )
}

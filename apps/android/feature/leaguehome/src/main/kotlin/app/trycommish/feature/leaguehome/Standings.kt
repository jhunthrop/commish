package app.trycommish.feature.leaguehome

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import app.trycommish.core.leaguehome.Standings
import app.trycommish.core.leaguehome.StandingsRow
import app.trycommish.design.Basis
import app.trycommish.design.BoxColumn
import app.trycommish.design.BoxRow
import app.trycommish.design.BoxTable
import app.trycommish.design.CellKind
import app.trycommish.design.Section
import app.trycommish.design.Words

private val RANK_W = 24.dp
private val RECORD_W = 50.dp
private val POINTS_W = 52.dp
private val PROJ_W = 48.dp
private val WAIVER_W = 56.dp

/** Under this width the table keeps the web phone's columns (web Standings.svelte at 760 px and
 * under): rank, team with its streak, record, PF and Proj. */
private val COMPACT_UNDER = 600.dp

/** One column of the standings and the cell each row puts in it. */
private class StandingsColumn(
    val column: BoxColumn,
    val cell: (StandingsRow) -> String,
)

/** The columns for the room there is: PA and the waiver column only where the table is wide. */
private fun columns(
    standings: Standings,
    compact: Boolean,
): List<StandingsColumn> {
    val words = Words.LeagueHome
    return listOfNotNull(
        StandingsColumn(BoxColumn(words.rank, RANK_W, CellKind.Plain)) { it.rank.toString() },
        StandingsColumn(BoxColumn(words.team, kind = CellKind.Name)) { it.name },
        StandingsColumn(BoxColumn(words.record, RECORD_W)) { it.record },
        StandingsColumn(BoxColumn(words.pointsFor, POINTS_W)) { it.pointsFor },
        StandingsColumn(BoxColumn(words.pointsAgainst, POINTS_W)) { it.pointsAgainst }.takeUnless { compact },
        StandingsColumn(BoxColumn(Words.Box.proj, PROJ_W)) { it.proj }.takeIf { standings.projected },
        standings.waiverHead?.let { head -> StandingsColumn(BoxColumn(head, WAIVER_W)) { it.waiver } }?.takeUnless { compact },
    )
}

/** The standings as a box score in the platform's order: record, PF, PA, the week's Proj while the
 * scoreboard answers, the waiver column; the streak under each name; the basis said once. */
@Composable
internal fun Standings(standings: Standings) {
    Section(Words.LeagueHome.standings) {
        BoxWithConstraints {
            val shown = columns(standings, compact = maxWidth < COMPACT_UNDER)
            val rows =
                standings.rows.map { row ->
                    BoxRow(row.rosterId.toString(), shown.map { it.cell(row) }, mine = row.me, note = row.streak.ifEmpty { null })
                }
            BoxTable(shown.map { it.column }, rows)
        }
        Basis(standings.basis)
    }
}

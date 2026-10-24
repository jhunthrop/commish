package app.trycommish.core.leaguehome

import app.trycommish.api.models.LeagueMove
import app.trycommish.api.models.LeagueSync
import app.trycommish.api.models.LeagueTeam
import app.trycommish.api.models.LeagueTerms
import app.trycommish.api.models.MovePlayer
import app.trycommish.api.models.RosterSpot
import app.trycommish.api.models.Scoreboard
import app.trycommish.core.Format
import app.trycommish.design.Words
import java.time.Instant
import java.time.ZoneId

/*
 * The standings, the lineup summary and the moves, ported from web/src/lib/league/home/home.ts
 * (standingsRows, waiverColumn, waiverCell, recordCell, standingsBasis, feedRows).
 */

private fun figure(value: Double?): String = value?.let { Format.fixed(it) } ?: Words.Box.none

private fun waiverHead(terms: LeagueTerms): String? =
    when (terms.waivers) {
        LeagueTerms.Waivers.budget -> Words.LeagueHome.budget
        LeagueTerms.Waivers.order -> Words.LeagueHome.order
        else -> null
    }

/** "$675" left of the budget, "6th" in the order, "--" where unsaid. */
private fun waiverCell(
    team: LeagueTeam,
    terms: LeagueTerms,
): String {
    val budget = team.waiverBudgetLeft
    val order = team.waiverOrder
    return when {
        terms.waivers == LeagueTerms.Waivers.budget && budget != null -> "$${Format.count(budget)}"
        terms.waivers == LeagueTerms.Waivers.order && order != null -> Format.ordinal(order)
        else -> Words.Box.none
    }
}

/** What the standings' numbers are, said once: the order and its tiebreak, PF and PA, the streak, the
 * waiver column (home.ts standingsBasis, tiebreakWords and waiverBasis, built as the web builds them). */
internal fun standingsBasis(sync: LeagueSync): String {
    val platform = ValueWords.platform(sync.host)
    val terms = sync.terms
    val after = terms.tiebreak?.let(ValueWords::tiebreak)?.let { "then $it" } ?: "then points for, as $platform lists them"
    val words = Words.LeagueHome
    return "Standings follow $platform's record, $after. ${words.pointsFor} and ${words.pointsAgainst} are points for and against, " +
        "${words.streak} the current run${waiverBasis(platform, terms)}."
}

private fun waiverBasis(
    platform: String,
    terms: LeagueTerms,
): String =
    when (terms.waivers) {
        LeagueTerms.Waivers.budget -> {
            val of = terms.waiverBudget?.let { " of $${Format.count(it)}" }.orEmpty()
            ", ${Words.LeagueHome.budget} the budget left$of"
        }
        LeagueTerms.Waivers.order -> {
            val order = terms.waiverOrder?.let(ValueWords::waiverOrder)
            val how = order?.let { "$it, ${Words.LeagueHome.firstPicks}" } ?: Words.LeagueHome.firstPicks
            ", ${Words.LeagueHome.order} the place in $platform's order ($how)"
        }
        else -> ""
    }

/** The standings in the platform's order, with each team's projection this week. */
internal fun standings(
    sync: LeagueSync,
    board: Scoreboard?,
    now: Instant,
): Standings {
    val proj = projections(board, now)
    return Standings(
        waiverHead = waiverHead(sync.terms),
        projected = board != null,
        rows =
            sync.teams.mapIndexed { i, team ->
                StandingsRow(
                    rosterId = team.rosterId,
                    rank = i + 1,
                    name = team.name,
                    me = team.rosterId == sync.me,
                    record = "${team.wins}-${team.losses}-${team.ties}",
                    pointsFor = Format.fixed(team.pointsFor),
                    pointsAgainst = figure(team.pointsAgainst),
                    streak = team.streak.orEmpty(),
                    waiver = waiverCell(team, sync.terms),
                    proj = figure(proj[team.rosterId]),
                )
            },
        basis = standingsBasis(sync),
    )
}

/** A position as the box prints it: the platform's DEF is D/ST. */
private fun position(raw: String): String = if (raw == "DEF") "D/ST" else raw

/** The member's starters as the platform has them set; the bench and injured reserve as counts. */
internal fun lineupSummary(sync: LeagueSync): LineupSummary {
    val starters =
        sync.roster.filter { it.slot == RosterSpot.Slot.starter }.map {
            LineupLine(it.player.hostId, position(it.player.position), it.player.name, it.player.team)
        }
    val bench = sync.roster.count { it.slot == RosterSpot.Slot.bench }
    val reserve = sync.roster.count { it.slot == RosterSpot.Slot.reserve }
    val benchWords = "${Words.Box.bench}, ${Format.plural(bench, "player", "players")}"
    return LineupSummary(
        team =
            sync.teams
                .firstOrNull { it.rosterId == sync.me }
                ?.name
                .orEmpty(),
        starters = starters,
        bench = if (reserve > 0) "$benchWords. ${Words.Box.reserve}, $reserve" else benchWords,
    )
}

/** The league's moves as feed rows, newest first, as the read holds them. */
internal fun movesFeed(
    sync: LeagueSync,
    zone: ZoneId,
): MovesFeed {
    val names = sync.teams.associate { it.rosterId to it.name }
    val nameOf = { id: Int -> names[id] ?: teamFallback(id) }
    val player = { trade: Boolean ->
        { m: MovePlayer ->
            FeedPlayer(m.player.hostId, m.player.name, position(m.player.position), m.player.team, if (trade) nameOf(m.rosterId) else null)
        }
    }
    val rows =
        sync.moves.mapIndexed { i, move ->
            val trade = move.kind == LeagueMove.Kind.trade
            val dropOnly = !trade && move.adds.isEmpty() && move.drops.isNotEmpty()
            MoveRow(
                key = "${move.at}-$i",
                whenText = Format.weekdayTime(Instant.parse(move.at), zone),
                kind = if (dropOnly) Words.MoveKind.drop else ValueWords.moveKind(move.kind),
                teams = move.rosterIds.map(nameOf),
                mine = sync.me in move.rosterIds,
                adds = move.adds.map(player(trade)),
                drops = if (trade) emptyList() else move.drops.map(player(false)),
                detail = move.bid?.let { "${Words.LeagueHome.budget} $${Format.count(it)}" }.orEmpty(),
            )
        }
    return MovesFeed(rows, if (rows.isEmpty()) Words.LeagueHome.noMoves else null)
}

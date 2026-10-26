package app.trycommish.core.companion

import app.trycommish.api.models.CompanionHost
import app.trycommish.api.models.CompanionPick
import app.trycommish.api.models.CompanionStatus
import app.trycommish.api.models.DraftCompanion
import app.trycommish.api.models.OutcomeRange
import app.trycommish.api.models.RoomCard
import app.trycommish.core.board.Heat
import app.trycommish.design.Words

/**
 * The followed draft as the companion's page draws it at a moment (CompanionRoom.svelte), from the latest
 * answer, the picks held across reads and the board read with the first: pure, the iOS CompanionModel's
 * and held to shared/fixtures/parity/companion.json.
 */
data class CompanionModel(
    val status: CompanionStatus,
    val bar: CompanionBar,
    val lost: String?,
    val notes: List<String>,
    val names: List<String>,
    /** The picks as they land, newest first; not at your turn, which draws the picks since your last. */
    val strip: PickStripModel?,
    val since: PickStripModel?,
    val call: CallModel?,
    val shortlist: List<ShortlistLine>?,
    val pool: PoolModel?,
    /** The draft board, every round through the one on the clock. */
    val wall: RoomWall,
    val team: TeamModel,
) {
    val isComplete: Boolean get() = status == CompanionStatus.complete

    companion object {
        /** The picks the landing strip shows (model.ts STRIP_PICKS): a round of a 12-team draft. */
        private const val STRIP_PICKS = 12

        /** The moment's model. `seen` is how many name-matched picks the drafter was already told of (the
         * page's namedSeen), `filter` the pool's chip. */
        fun of(
            draft: DraftCompanion,
            picks: List<CompanionPick>,
            board: RoomBoardView,
            seen: Int,
            filter: String,
        ): CompanionModel {
            val teams = draft.teams
            val placed = placed(picks)
            val drafted = RoomDraft.drafted(placed)
            val now = draft.pickCount + 1
            val previous = RoomDraft.turnBefore(now, draft.slot, teams)
            val card = draft.card
            val call = card?.takeIf { draft.yourTurn || it.conditional }?.let { CallView.of(it, board, drafted, teams) }
            val onTurn = call != null && draft.yourTurn
            val names = CompanionWords.seatNames(draft)
            val named = if (draft.yourTurn) draft.placedByName.drop(seen) else draft.placedByName
            val complete = draft.status == CompanionStatus.complete
            val went = RoomDraft.wentSince(placed, previous ?: 0, board)
            return CompanionModel(
                status = draft.status,
                bar = bar(draft),
                lost = CompanionWords.lost(draft),
                notes = CompanionWords.notes(draft, named),
                names = names,
                strip = if (onTurn) null else landing(draft, picks, board, names),
                since = if (onTurn && went.isNotEmpty()) since(went, previous, teams) else null,
                call = call?.let { call(it, onTurn, draft.host) },
                shortlist = if (onTurn) card?.let { shortlist(it, board, teams, draft.ranges.orEmpty()) } else null,
                pool = if (complete) null else pool(draft, board, drafted, call, filter),
                wall =
                    RoomWall.of(
                        placed,
                        board,
                        names,
                        draft.slot,
                        teams,
                        draft.rounds,
                        shown = minOf(draft.rounds, DraftFormat.snakeSlot(minOf(now, draft.totalPicks), teams).round),
                        now = if (complete) null else now,
                    ),
                team = team(draft, placed, board),
            )
        }

        private fun bar(draft: DraftCompanion): CompanionBar =
            CompanionBar(
                figure = CompanionWords.pickCount(draft),
                caption = CompanionWords.picksMade(draft.host),
                section = CompanionWords.draftOn(draft.host),
                title = CompanionWords.draftName(draft.name),
                league = RoomWords.leagueLine(draft.settings, draft.slot),
                turn = CompanionWords.turn(draft),
                onTurn = draft.yourTurn,
                stale = CompanionWords.stale(draft),
                open = CompanionWords.openDraft(draft.host),
                openUrl = CompanionWords.draftUrl(draft.host, draft.hostDraftId),
            )

        /** model.ts roomPicks: the picks placed on our board; one we could not place takes nobody. */
        internal fun placed(picks: List<CompanionPick>): List<PlacedPick> =
            picks.mapNotNull { pick -> pick.playerId?.let { PlacedPick(pick.pick, pick.round, pick.seat, it) } }

        /** model.ts pickPlayer: our board's player, the platform's name for one we could not place, or null
         * for a position we do not draft. */
        private fun player(
            pick: CompanionPick,
            board: RoomBoardView,
        ): RoomPlayer? {
            pick.playerId?.let { id -> board.byId[id]?.let { return it } }
            val position = if (pick.position == "DEF") "DST" else pick.position
            if (position !in RoomDraft.filters.drop(1)) return null
            return RoomPlayer(
                id = "unplaced:${pick.hostPlayerId}",
                name = pick.name,
                position = position,
                positionRank = 0,
                team = pick.team,
                headshot = "",
                adp = null,
                points = null,
                vor = null,
                gap = null,
                vorRound = null,
                bye = null,
            )
        }

        /** model.ts landingStrip: the last picks, newest first, each with its pick and who made it. */
        private fun landing(
            draft: DraftCompanion,
            picks: List<CompanionPick>,
            board: RoomBoardView,
            names: List<String>,
        ): PickStripModel? {
            val faces =
                picks.takeLast(STRIP_PICKS).reversed().withIndex().mapNotNull { (index, pick) ->
                    player(pick, board)?.let { player ->
                        val mine = pick.seat == draft.slot
                        val who = if (mine) Words.Companion.you else names.getOrNull(pick.seat - 1).orEmpty()
                        StripFace(
                            pick.pick,
                            player,
                            DraftFormat.lastName(player.name),
                            listOf(DraftFormat.pickLabel(pick.pick, draft.teams), who),
                            newest = index == 0,
                            strong = mine,
                        )
                    }
                }
            if (faces.isEmpty()) return null
            return PickStripModel(
                lead = DraftFormat.pickLabel(picks.lastOrNull()?.pick ?: 1, draft.teams),
                lines = listOf(CompanionWords.justTaken(draft.host), Words.Companion.newestFirst),
                picks = faces,
            )
        }

        /** SinceStrip.svelte without a queue: every pick since your last one. */
        private fun since(
            went: List<WentPick>,
            previous: Int?,
            teams: Int,
        ): PickStripModel =
            PickStripModel(
                lead = went.size.toString(),
                lines = listOf(RoomWords.sinceLead(previous, teams)),
                picks =
                    went.map { (player, pick) ->
                        StripFace(
                            pick,
                            player,
                            DraftFormat.lastName(player.name),
                            listOf(DraftFormat.pickLabel(pick, teams)),
                            newest = false,
                            strong = false,
                        )
                    },
            )

        private fun call(
            view: CallView,
            onTurn: Boolean,
            host: CompanionHost,
        ): CallModel =
            CallModel(
                tag = view.tag,
                chanceHead = view.chanceHead,
                verb = if (onTurn) CompanionWords.makePick(host) else CompanionWords.queue(host),
                waiting = view.conditional,
                rows =
                    view.rows.map { row ->
                        val chance = if (view.chanceHead == null) "" else row.chance?.let(DraftFormat::chanceShort).orEmpty()
                        CallLine(row.player, RoomWords.callValue(row), chance)
                    },
            )

        /** Shortlist.svelte: the shortlist after the call, each with his chance and what it is of, our why's
         * first sentence, and his range on the scale the list's ranges share. */
        internal fun shortlist(
            card: RoomCard,
            board: RoomBoardView,
            teams: Int,
            ranges: Map<String, OutcomeRange>,
        ): List<ShortlistLine> {
            val label = CompanionWords.chanceLabel(card, teams)
            val rows =
                card.shortlist
                    .filter { it.playerId != card.call }
                    .mapNotNull { entry -> board.byId[entry.playerId]?.let { Triple(entry, it, ranges[entry.playerId]?.let(::points)) } }
            val scale = RangeScale.shared(rows.mapNotNull { it.third })
            return rows.map { (entry, player, range) ->
                ShortlistLine(
                    player = player,
                    chance = card.stillThere[entry.playerId]?.let(DraftFormat::chanceShort),
                    label = label,
                    why = entry.why?.takeIf { it.isNotEmpty() }?.let(Sentence::first),
                    range = if (range != null && scale != null) RangeLine.of(range, scale) else null,
                )
            }
        }

        private fun points(range: OutcomeRange): PointsRange = PointsRange(range.floor, range.median, range.ceiling)

        private fun pool(
            draft: DraftCompanion,
            board: RoomBoardView,
            drafted: Set<String>,
            call: CallView?,
            filter: String,
        ): PoolModel {
            val card = draft.card
            val chances = card?.stillThere.orEmpty()
            return PoolModel(
                line = RoomWords.poolLine(board.players.size - drafted.size),
                basis = if (call != null) RoomWords.poolBasis(board, card, draft.teams) else draft.basis,
                chanceHead = call?.let { CompanionWords.chanceColumn(card) },
                chanceLabel = CompanionWords.chanceLabel(card, draft.teams),
                missing = RoomWords.chanceMissing(gone = false, read = chances.isNotEmpty()),
                filter = filter,
                rows =
                    RoomDraft.pool(board, drafted, filter).map { player ->
                        val vor = player.vor
                        val round = player.vorRound
                        PoolLine(
                            player = player,
                            value = RoomWords.value(player),
                            heat = if (vor != null && round != null) Heat.of(vor, round) else null,
                            chance = if (call == null) null else chances[player.id]?.let(DraftFormat::chanceShort),
                            isCall = player.id == call?.player?.id,
                        )
                    },
            )
        }

        private fun team(
            draft: DraftCompanion,
            placed: List<PlacedPick>,
            board: RoomBoardView,
        ): TeamModel {
            val slots = RoomDraft.team(draft.settings.roster, draft.settings.lineup, placed.filter { it.seat == draft.slot }, board)
            return TeamModel(
                count = RoomWords.teamCount(slots.count { it.player != null }, draft.rounds),
                slots = slots.map { TeamLine(it.slot, it.player, it.pick?.let { pick -> DraftFormat.pickLabel(pick, draft.teams) }) },
            )
        }
    }
}

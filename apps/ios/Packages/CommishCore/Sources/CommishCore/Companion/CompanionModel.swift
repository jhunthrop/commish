import CommishAPI
import CommishDesign
import Foundation

/// The bar at the head of the followed draft (CompanionBar.svelte): the platform's pick count where a
/// mock room's clock would be (we never show a clock we do not own), the draft, the league, when you
/// are up, the platform gone quiet, and the way back to its draft room.
public struct CompanionBar: Equatable, Sendable {
    public let figure: String
    public let caption: String
    public let section: String
    public let title: String
    public let league: String
    public let turn: String
    public let onTurn: Bool
    public let stale: String?
    public let open: String
    public let openURL: URL?
}

/// One face on a strip of picks (types/room.ts StripPick).
public struct StripFace: Equatable, Sendable, Identifiable {
    /// The overall pick.
    public let id: Int
    public let player: RoomPlayer
    /// His last name, as the strip prints it.
    public let name: String
    public let lines: [String]
    /// The newest pick, marked in ink.
    public let newest: Bool
    /// The line after the name in ink: a pick the drafter made.
    public let strong: Bool
}

/// A strip of picks with its lead (PickStrip.svelte): the newest pick's label and its lines, or the
/// count since your pick.
public struct PickStripModel: Equatable, Sendable {
    public let lead: String
    public let lines: [String]
    public let picks: [StripFace]
}

/// A call row as the panel prints it (CallPanel.svelte at 390: face, player, Over repl, the chance).
public struct CallLine: Equatable, Sendable, Identifiable {
    public let player: RoomPlayer
    public let value: String
    public let chance: String

    public var id: String {
        player.id
    }
}

/// Our call (RoomCall.svelte): its tag, its chance head, its rows and the one verb, quiet off the clock.
public struct CallModel: Equatable, Sendable {
    public let tag: String
    public let chanceHead: String?
    public let verb: String
    /// Off your turn the call waits on the board: a quiet edge and a quiet verb.
    public let waiting: Bool
    public let rows: [CallLine]
}

/// Who we would take next (Shortlist.svelte): each with his chance of lasting and what it is of, our
/// why's first sentence with full_reasoning, and his outcome range on the list's shared scale with
/// range_of_outcomes.
public struct ShortlistLine: Equatable, Sendable, Identifiable {
    public let player: RoomPlayer
    public let chance: String?
    public let label: String
    public let why: String?
    public let range: RangeLine?

    public var id: String {
        player.id
    }
}

/// A pool row (PoolRow.svelte at 390): face, player, Over repl on its round's tint, the chance.
public struct PoolLine: Equatable, Sendable, Identifiable {
    public let player: RoomPlayer
    public let value: String
    public let heat: Heat?
    /// His chance under the column, nil where the column is not drawn or the card holds none.
    public let chance: String?
    public let isCall: Bool

    public var id: String {
        player.id
    }
}

/// The pool (Pool.svelte): its count, the basis over it, the chance column's head and every row under
/// the chip, the screen drawing the first and then more.
public struct PoolModel: Equatable, Sendable {
    public let line: String
    public let basis: String
    /// The chance column's head, nil when no call with chances is coming.
    public let chanceHead: String?
    public let chanceLabel: String
    /// What a row with no chance says under the column.
    public let missing: String
    public let filter: String
    public let rows: [PoolLine]

    /// Pool.svelte FIRST_ROWS and MORE_ROWS.
    public static let firstRows = 14
    public static let moreRows = 25

    /// The chips, the one under which the rows are drawn pressed.
    public var chips: [BoardChip<String>] {
        RoomDraft.filters.map { BoardChip(label: $0, value: $0, pressed: $0 == filter) }
    }

    /// The pool's line when the chip leaves nobody.
    public var empty: String? {
        rows.isEmpty ? RoomWords.poolEmpty(filter: filter) : nil
    }
}

/// Your team (TeamPanel.svelte): the count, then each filled slot with the pick that took him and each
/// open one.
public struct TeamModel: Equatable, Sendable {
    public let count: String
    public let slots: [TeamLine]
}

public struct TeamLine: Equatable, Sendable, Identifiable {
    public let id: Int
    public let slot: String
    public let player: RoomPlayer?
    public let pick: String?
}

/// The followed draft as the companion's page draws it at a moment (CompanionRoom.svelte), from the
/// latest answer, the picks held across reads and the board read with the first: pure, held to
/// shared/fixtures/parity/companion.json.
public struct CompanionModel: Equatable, Sendable {
    public let status: String
    public let bar: CompanionBar
    public let lost: String?
    public let notes: [String]
    public let names: [String]
    /// The picks as they land, newest first; not at your turn, which draws the picks since your last.
    public let strip: PickStripModel?
    public let since: PickStripModel?
    public let call: CallModel?
    public let shortlist: [ShortlistLine]?
    public let pool: PoolModel?
    /// The draft board, every round through the one on the clock.
    public let wall: RoomWall
    public let team: TeamModel

    /// The picks the landing strip shows (model.ts STRIP_PICKS): a round of a 12-team draft.
    static let stripPicks = 12

    public var isComplete: Bool {
        status == "complete"
    }

    /// The moment's model. `seen` is how many name-matched picks the drafter was already told of (the
    /// page's namedSeen), `filter` the pool's chip.
    public init(companion draft: Companion, picks: [CompanionPick], board: RoomBoardView, seen: Int, filter: String) {
        let teams = draft.teams
        let placed = Self.placed(picks)
        let drafted = RoomDraft.drafted(placed)
        let now = draft.pickCount + 1
        let previous = RoomDraft.turnBefore(now, seat: draft.slot, teams: teams)
        let card = draft.card?.value1
        let call = card.flatMap { card in
            draft.yourTurn || card.conditional ? CallView(card, board: board, drafted: drafted, teams: teams) : nil
        }
        let onTurn = call != nil && draft.yourTurn
        let names = CompanionWords.seatNames(draft)
        let named = draft.yourTurn ? Array(draft.placedByName.dropFirst(seen)) : draft.placedByName
        status = CompanionWords.status(draft.status)
        bar = CompanionBar(
            figure: CompanionWords.pickCount(draft), caption: CompanionWords.picksMade(draft.host),
            section: CompanionWords.draftOn(draft.host), title: CompanionWords.draftName(draft.name),
            league: RoomWords.leagueLine(draft.settings, slot: draft.slot), turn: CompanionWords.turn(draft),
            onTurn: draft.yourTurn,
            stale: CompanionWords.stale(draft), open: CompanionWords.openDraft(draft.host),
            openURL: CompanionWords.draftURL(draft.host, draftID: draft.hostDraftId)
        )
        lost = CompanionWords.lost(draft)
        notes = CompanionWords.notes(draft, named: named)
        self.names = names
        strip = onTurn ? nil : Self.landing(draft, picks: picks, board: board, names: names)
        let went = RoomDraft.wentSince(placed, since: previous ?? 0, board: board)
        since = onTurn && !went.isEmpty ? Self.since(went, previous: previous, teams: teams) : nil
        self.call = call.map { Self.call($0, onTurn: onTurn, host: draft.host) }
        shortlist = onTurn ? card.map {
            Self.shortlist($0, board: board, teams: teams, ranges: draft.ranges?.additionalProperties ?? [:])
        } : nil
        pool = status == "complete" ? nil : Self.pool(
            draft, board: board, drafted: drafted, call: call, filter: filter
        )
        let complete = status == "complete"
        wall = RoomWall(
            picks: placed, board: board, names: names, you: draft.slot, teams: teams, rounds: draft.rounds,
            shown: min(draft.rounds, DraftFormat.snakeSlot(min(now, draft.totalPicks), teams: teams).round),
            now: complete ? nil : now
        )
        team = Self.team(draft, placed: placed, board: board)
    }

    /// model.ts roomPicks: the picks placed on our board; one we could not place takes nobody.
    static func placed(_ picks: [CompanionPick]) -> [PlacedPick] {
        picks.compactMap { pick in
            pick.playerId.map { PlacedPick(pick: pick.pick, round: pick.round, seat: pick.seat, playerID: $0) }
        }
    }

    /// model.ts pickPlayer: our board's player, the platform's name for one we could not place, or nil
    /// for a position we do not draft.
    static func player(_ pick: CompanionPick, board: RoomBoardView) -> RoomPlayer? {
        if let id = pick.playerId, let ours = board.byID[id] {
            return ours
        }
        let position = pick.position == "DEF" ? "DST" : pick.position
        guard RoomDraft.filters.dropFirst().contains(position) else {
            return nil
        }
        return RoomPlayer(
            id: "unplaced:\(pick.hostPlayerId)", name: pick.name, position: position, positionRank: 0, team: pick.team,
            headshot: "", adp: nil, points: nil, vor: nil, gap: nil, vorRound: nil, bye: nil
        )
    }

    /// model.ts landingStrip: the last picks, newest first, each with its pick and who made it.
    static func landing(
        _ draft: Companion,
        picks: [CompanionPick],
        board: RoomBoardView,
        names: [String]
    ) -> PickStripModel? {
        let faces = picks.suffix(stripPicks).reversed().enumerated().compactMap { index, pick -> StripFace? in
            player(pick, board: board).map { player in
                let who = pick.seat == draft.slot ? Words.Companion
                    .you : (pick.seat - 1 < names.count ? names[pick.seat - 1] : "")
                return StripFace(
                    id: pick.pick, player: player, name: DraftFormat.lastName(player.name),
                    lines: [DraftFormat.pickLabel(pick.pick, teams: draft.teams), who], newest: index == 0,
                    strong: pick.seat == draft.slot
                )
            }
        }
        guard !faces.isEmpty else {
            return nil
        }
        return PickStripModel(
            lead: DraftFormat.pickLabel(picks.last?.pick ?? 1, teams: draft.teams),
            lines: [CompanionWords.justTaken(draft.host), Words.Companion.newestFirst], picks: faces
        )
    }

    /// SinceStrip.svelte without a queue: every pick since your last one.
    static func since(_ went: [(RoomPlayer, Int)], previous: Int?, teams: Int) -> PickStripModel {
        PickStripModel(
            lead: String(went.count), lines: [RoomWords.sinceLead(previous, teams: teams)],
            picks: went.map { player, pick in
                StripFace(
                    id: pick, player: player, name: DraftFormat.lastName(player.name),
                    lines: [DraftFormat.pickLabel(pick, teams: teams)], newest: false, strong: false
                )
            }
        )
    }

    static func call(_ view: CallView, onTurn: Bool, host: Components.Schemas.CompanionHost) -> CallModel {
        CallModel(
            tag: view.tag, chanceHead: view.chanceHead,
            verb: onTurn ? CompanionWords.makePick(host) : CompanionWords.queue(host), waiting: view.conditional,
            rows: view.rows.map { row in
                CallLine(
                    player: row.player, value: RoomWords.callValue(row),
                    chance: view.chanceHead == nil ? "" : row.chance.map(DraftFormat.chanceShort) ?? ""
                )
            }
        )
    }

    /// Shortlist.svelte: the shortlist after the call, each with his chance and what it is of, our
    /// why's first sentence, and his range on the scale the list's ranges share.
    static func shortlist(
        _ card: RoomCard, board: RoomBoardView, teams: Int, ranges: [String: Components.Schemas.OutcomeRange]
    ) -> [ShortlistLine] {
        let label = CompanionWords.chanceLabel(card, teams: teams)
        let rows = card.shortlist.filter { $0.playerId != card.call }.compactMap { entry in
            board.byID[entry.playerId].map { (entry, $0, ranges[entry.playerId]) }
        }
        let scale = RangeScale.shared(rows.compactMap { $0.2.map { (floor: $0.floor, ceiling: $0.ceiling) } })
        return rows.map { entry, player, range in
            ShortlistLine(
                player: player,
                chance: card.stillThere.additionalProperties[entry.playerId].map(DraftFormat.chanceShort),
                label: label,
                why: entry.why.flatMap { $0.isEmpty ? nil : Sentence.first($0) },
                range: zip(range, scale).map {
                    RangeLine(floor: $0.0.floor, median: $0.0.median, ceiling: $0.0.ceiling, scale: $0.1)
                }
            )
        }
    }

    static func pool(
        _ draft: Companion, board: RoomBoardView, drafted: Set<String>, call: CallView?, filter: String
    ) -> PoolModel {
        let card = draft.card?.value1
        let chances = card?.stillThere.additionalProperties ?? [:]
        return PoolModel(
            line: RoomWords.poolLine(board.players.count - drafted.count),
            basis: call != nil ? RoomWords.poolBasis(board, card: card, teams: draft.teams) : draft.basis,
            chanceHead: call != nil ? CompanionWords.chanceColumn(card) : nil,
            chanceLabel: CompanionWords.chanceLabel(card, teams: draft.teams),
            missing: RoomWords.chanceMissing(gone: false, read: !chances.isEmpty),
            filter: filter,
            rows: RoomDraft.pool(board, drafted: drafted, filter: filter).map { player in
                PoolLine(
                    player: player, value: RoomWords.value(player),
                    heat: zip(player.vor, player.vorRound).map { Heat.of(vor: $0.0, round: $0.1) },
                    chance: call == nil ? nil : chances[player.id].map(DraftFormat.chanceShort),
                    isCall: player.id == call?.player.id
                )
            }
        )
    }

    static func team(_ draft: Companion, placed: [PlacedPick], board: RoomBoardView) -> TeamModel {
        let slots = RoomDraft.team(draft.settings, mine: placed.filter { $0.seat == draft.slot }, board: board)
        return TeamModel(
            count: RoomWords.teamCount(slots.count { $0.player != nil }, of: draft.rounds),
            slots: slots.enumerated().map { index, slot in
                TeamLine(
                    id: index, slot: slot.slot, player: slot.player,
                    pick: slot.pick.map { DraftFormat.pickLabel($0, teams: draft.teams) }
                )
            }
        )
    }
}

/// Two optionals as one pair, nil unless both are there.
private func zip<A, B>(_ first: A?, _ second: B?) -> (A, B)? {
    guard let first, let second else {
        return nil
    }
    return (first, second)
}

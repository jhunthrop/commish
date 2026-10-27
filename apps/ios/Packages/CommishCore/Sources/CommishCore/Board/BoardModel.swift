import CommishAPI
import CommishDesign
import Foundation

/// A position view of the board, as the run names the positions (derive.ts POSITIONS, in that order).
/// Kickers and defenses are listed in the drafts' order, with no projection of ours.
public enum BoardPosition: String, CaseIterable, Sendable, Hashable {
    case quarterback = "QB"
    case runningBack = "RB"
    case receiver = "WR"
    case tightEnd = "TE"
    case kicker = "K"
    case defense = "DST"

    public var label: String {
        self == .defense ? Words.Board.defense : rawValue
    }

    /// A kicker's or a defense's view: the drafts' order, no points of ours.
    var draftOrder: Bool {
        self == .kicker || self == .defense
    }

    /// What a tier's players are called, one and many (derive.ts POSITION_NAMES, generated).
    var group: (one: String, many: String) {
        switch self {
        case .quarterback: (Words.TierGroup.QBOne, Words.TierGroup.QBMany)
        case .runningBack: (Words.TierGroup.RBOne, Words.TierGroup.RBMany)
        case .receiver: (Words.TierGroup.WROne, Words.TierGroup.WRMany)
        case .tightEnd: (Words.TierGroup.TEOne, Words.TierGroup.TEMany)
        case .kicker: (Words.TierGroup.KOne, Words.TierGroup.KMany)
        case .defense: (Words.TierGroup.DSTOne, Words.TierGroup.DSTMany)
        }
    }
}

/// A chip: its words, what it chooses, and whether it is the one pressed.
public struct BoardChip<Value: Hashable & Sendable>: Equatable, Sendable, Identifiable {
    public let label: String
    public let value: Value
    public let pressed: Bool

    public var id: String {
        label
    }
}

/// The Gap's tone (gap-picks.ts gapTone): plus when drafters wait, minus when they reach.
public enum GapTone: Sendable, Equatable {
    case gain
    case loss
    case even

    init?(_ gap: Double?) {
        guard let gap else {
            return nil
        }
        self = gap > 0 ? .gain : gap < 0 ? .loss : .even
    }
}

/// The tint on a row's Over replacement (ui/heat.ts heatFor): the round his value ranks in, rounds 1 to
/// 4, the rose wash below replacement, none after the fourth round.
public enum Heat: Sendable, Equatable {
    case round(Int)
    case below
    case none

    /// heat.ts TINTED_ROUNDS.
    static let tintedRounds = 1 ... 4

    public static func of(vor: Double, round: Int) -> Heat {
        if vor < 0 {
            return .below
        }
        return tintedRounds.contains(round) ? .round(round) : .none
    }

    /// The web's class for the tint: "heat-1", "heat-neg", "none".
    public var name: String {
        switch self {
        case let .round(round): "heat-\(round)"
        case .below: "heat-neg"
        case .none: "none"
        }
    }
}

/// One player's row as the web's board row draws it at 390 (Row.svelte): his name the biggest thing,
/// his position pill with his number there (or the list he is on), his club and bye under it, his
/// status chip,
/// then the view's figures.
public struct BoardRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let initials: String
    /// His face (the run's headshot), nil for a defense, which has none; the initials stand in.
    public let headshot: URL?
    /// "WR 4", "RB IR", "DST".
    public let pill: String
    public let club: String
    /// "Bye week 11" while it is ahead of the week a rest-of-season board ranks from; nil once played or
    /// when the run names no bye for his club.
    public let bye: String?
    public let status: RowStatus?
    /// His projected points, the row's one big number; the empty figure for a kicker or a defense.
    public let projected: String
    /// Over replacement, signed, and its tint.
    public let overReplacement: String
    public let heat: Heat
    public let gap: String
    public let gapTone: GapTone?
    /// A kicker's or a defense's place in the drafts' order.
    public let draftOrder: String
    public let adp: String
    /// The player his row opens in the sheet; nil where the site has no page for him.
    public let sheetPlayer: SheetPlayer?
    /// A defense: its face is its club's chip (B245), never a logo.
    public let clubMark: Bool
}

/// A tier's band over its rows as the phone draws it (TierStrip.svelte): its number on the tier's
/// shade, its name and count, and its drop to the next tier, or the last tier's words.
public struct TierBand: Equatable, Sendable {
    public let tier: Int
    /// "Tier 3".
    public let name: String
    /// "8 WRs".
    public let count: String
    /// The drop's figure, "16.9", nil where none is said.
    public let drop: String?
    /// "PPR pts to tier 4", or "Last tier" with no drop.
    public let dropWords: String

    /// The band's cliff as one line, "16.9 PPR pts to tier 4".
    public var cliff: String {
        drop.map { "\($0) \(dropWords)" } ?? dropWords
    }
}

/// A run of rows under a tier's band or a head: a position's tiers, its season-long list, a view's rows.
public struct BoardSection: Equatable, Sendable, Identifiable {
    public let id: String
    public let head: String?
    public let band: TierBand?
    public let rows: [BoardRow]

    /// The same section over some of its rows: a mock's slice of a long list.
    public func with(rows kept: [BoardRow]) -> BoardSection {
        BoardSection(id: id, head: head, band: band, rows: kept)
    }
}

/// The figures a view carries, each named once over the rows.
public enum BoardColumns: Equatable, Sendable {
    /// Projected, Over repl. and, where the board compares drafters with our rank, the Gap.
    case ranked(gap: Bool)
    /// A kicker's or a defense's place in the drafts' order and his ADP.
    case draftOrder

    public var heads: [String] {
        switch self {
        case let .ranked(gap):
            [Words.Figure.projected, Words.Board.overReplShort] + (gap ? [Words.Board.gap] : [])
        case .draftOrder:
            [Words.Board.draftOrder, Words.Board.adp]
        }
    }
}

/// The Board screen as the web's board says it at 390, from the run (GET /run/manifest, /run/boards,
/// /run/adp, /run/designations): the heading, the run's stamp and, in season, the weeks it ranks; the
/// format and position chips; the view's rows in the run's order, a position's in its tiers with their
/// cliffs; and the basis once. In season, once the order the in-season pages read (GET /order)
/// answers, the view is the order's: the run's rows it places, in its order with its figures (as far as
/// its read reaches, as the web's Rest of season, which is the order, reaches, the count said once when
/// the answer is cut), a position's with no tiers (they are the run's), the players it does not place
/// after them (on a season-long list, or returned with no figure) with their status's word, and the
/// order's lead under the heading and in the board sentence's place; until then the run's rows stand
/// and the basis says the run's day and time (Lane 224, LiveOrder).
public struct BoardModel: Equatable, Sendable {
    public let words: BoardWords
    /// "Updated Oct 21": the run every number comes from.
    public let stamp: String
    /// The weeks a rest-of-season board ranks, under the heading; nil on a board of the full season.
    public let restLine: String?
    public let formats: [BoardChip<String>]
    public let positions: [BoardChip<BoardPosition?>]
    public let columns: BoardColumns
    public let sections: [BoardSection]
    /// What the numbers are as the web's board says them, then the capture the statuses come from.
    public let basis: [String]

    public var rows: [BoardRow] {
        sections.flatMap(\.rows)
    }

    /// Whether the rows carry the order's figures at its clock.
    public let atClock: Bool

    /// `inSeason` is the rail's season; `following` whether the member follows a league; `order` the
    /// order as read at the screen's clock, nil while unread or when the read failed.
    public init(
        read: RunBoardRead, position: BoardPosition?, inSeason: Bool, following: Bool, now: Date, zone: TimeZone,
        order: OrderAtClock? = nil
    ) {
        let manifest = read.manifest.value
        let format = read.format
        let board = read.board.value
        let statuses = read.designations.value?.players.additionalProperties ?? [:]
        words = BoardWords.of(
            inSeason: inSeason,
            cover: BoardCover(
                season: manifest.season, label: format.label, position: position?.label,
                restOfSeason: format.rosFromWeek != nil
            ),
            following: following
        )
        stamp = RunWords.stamp(manifest)
        formats = manifest.formats.map { BoardChip(label: $0.label, value: $0.id, pressed: $0.id == format.id) }
        let present = Set(board.rows.map(\.positionName) + board.market.map(\.positionName))
        positions = [BoardChip(label: Words.Board.all, value: nil, pressed: position == nil)]
            + BoardPosition.allCases.filter { present.contains($0.rawValue) }.map {
                BoardChip(label: $0.label, value: $0, pressed: $0 == position)
            }
        let cells = BoardCells(
            statuses: statuses, byes: BoardCells.byes(read.clubs.value), fromWeek: format.rosFromWeek, zone: zone
        )
        let ranksRest = inSeason && format.rosFromWeek != nil
        let clock = ranksRest ? order.flatMap { ClockPlaces($0, format: format, zone: zone) } : nil
        let view = ViewRows(
            board: board, position: position, statuses: statuses, cells: cells, unit: format.unit, at: clock
        )
        sections = view.sections
        atClock = view.atClock
        // The head follows the basis's clock: the order's lead once its rows stand (review M2).
        restLine = (view.atClock ? order?.lead(teams: format.teams, zone: zone) : nil)
            ?? RunWords.restCaption(format, season: manifest.season)
        let compare = format.rosFromWeek == nil
        columns = position?.draftOrder == true ? .draftOrder : .ranked(gap: compare && view.carriesGap)
        let said = position?.draftOrder == true
            ? [BoardBasis.draftOrder(format, sources: read.sources.value)]
            : BoardBasis.ranked(.init(
                format: format, season: manifest.season, position: position, sources: read.sources.value,
                gap: columns == .ranked(gap: true)
            ))
        // A kicker's or a defense's view says the capture only when one of its rows is listed.
        let listed = position?.draftOrder != true || sections.flatMap(\.rows).contains { $0.status != nil }
        let capture = read.designations.value.flatMap { designations in
            listed ? BoardWords.capture(
                asOf: designations.readAt, checkedAt: designations.checkedAt, now: now, zone: zone
            ) : nil
        }
        let run = said + (capture.map { [$0] } ?? [])
        basis = position?.draftOrder == true || !ranksRest ? run
            : Self.atClock(run, format: format, season: manifest.season, lead: view.atClock ? order : nil, zone: zone)
            + (view.reach.map { [LiveOrderWords.reach(shown: $0.shown, total: $0.total)] } ?? [])
    }

    /// A ranked view's basis in season on its rows' clock: the order's lead in the board sentence's
    /// place once its rows stand, else the run's stamp after the whole basis (LiveOrder.basis).
    static func atClock(
        _ run: [String], format: RunFormat, season: Int, lead order: OrderAtClock?, zone: TimeZone
    ) -> [String] {
        LiveOrder.basis(
            run, board: BoardBasis.ourBoard(format, season: season),
            lead: order?.lead(teams: format.teams, zone: zone), stamp: LiveOrderWords.runStamp(format, zone: zone)
        )
    }

    /// The format chips with the chosen one pressed, alone over a format whose board could not be read,
    /// so the member can choose another; none before the run's manifest is read.
    public static func formatChips(_ formats: [RunFormat], chosen: String?) -> [BoardChip<String>] {
        formats.enumerated().map { index, format in
            BoardChip(
                label: format.label,
                value: format.id,
                pressed: format.id == chosen || (chosen == nil && index == 0)
            )
        }
    }
}

/// A view's sections over the run's board: All in the run's order, a ranked position in its tiers then
/// its season-long list, a kicker's or a defense's list in the drafts' order. At the order's clock a
/// ranked view is the rows the order places, in its order with its figures, a position's as one run with
/// no tiers, then the view's players it does not place, in the run's order with no figure: those on a
/// season-long list (review M1) and those the order returns with no figure (a player put on a list after
/// the nightly, Lane 243, B251), each with the word of the order's own row's status, else the run's,
/// else "--", as the Rankings draw him. The rows its read does not reach are not drawn, so no row of the
/// run's clock stands among them, and `reach` says how many of the view's rows are drawn only when the
/// answer is truly cut.
private struct ViewRows {
    let sections: [BoardSection]
    /// The view's ranked rows carry a Gap (format/gap.ts carriesGap).
    let carriesGap: Bool
    /// The rows are the order's.
    let atClock: Bool
    /// At the order's clock, the view's rows drawn and its rows on the run, when fewer are drawn.
    let reach: (shown: Int, total: Int)?

    init(
        board: RunBoardAnswer,
        position: BoardPosition?,
        statuses: BoardOrder.Statuses,
        cells: BoardCells,
        unit: String,
        at clock: ClockPlaces?
    ) {
        let drawn = position.map { BoardOrder.at(board.rows, position: $0) } ?? board.rows
        let reached = clock.map { clock in drawn.filter { clock.places[$0.id] != nil } } ?? []
        if position?.draftOrder != true, let clock, !reached.isEmpty,
           let placed = LiveOrder.placed(reached, id: \.id, places: clock.places) {
            let rows = placed.map {
                cells.placed(
                    $0.row,
                    figures: $0.row.figures.at($0.place, teams: clock.teams),
                    said: clock.said($0.row.id)
                )
            }
            let listed = BoardOrder.withStatuses(drawn, statuses)
                .filter { row in
                    clock.places[row.id] == nil && (BoardOrder.heldOut(row, statuses) || clock.rows[row.id] != nil)
                }
                .map { row in cells.listed(row, said: clock.said(row.id) ?? cells.held(row.id)) }
            sections = Self.atClock(rows, listed: listed, position: position)
            carriesGap = false
            atClock = true
            let shown = rows.count + listed.count
            reach = clock.cut && shown < drawn.count ? (shown, drawn.count) : nil
            return
        }
        atClock = false
        reach = nil
        guard let position else {
            let rows = BoardOrder.withStatuses(board.rows, statuses)
            sections = [BoardSection(id: "all", head: nil, band: nil, rows: rows.map(cells.ranked))]
            carriesGap = rows.contains { $0.gap != nil }
            return
        }
        guard !position.draftOrder else {
            let rows = BoardOrder.withStatuses(BoardOrder.at(board.market, position: position), statuses)
            sections = [BoardSection(id: position.rawValue, head: nil, band: nil, rows: rows.map { cells.market($0) })]
            carriesGap = false
            return
        }
        let rows = BoardOrder.withStatuses(BoardOrder.at(board.rows, position: position), statuses)
        let held = rows.filter { BoardOrder.heldOut($0, statuses) }
        let tiers = BoardOrder.tiers(rows, position: position, statuses).map { group in
            BoardSection(
                id: "\(position.rawValue)-\(group.tier)", head: nil,
                band: Self.band(group, position: position, unit: unit), rows: group.rows.map(cells.ranked)
            )
        }
        sections = tiers + (held.isEmpty ? [] : [BoardSection(
            id: "\(position.rawValue)-held", head: Words.Board.heldHead, band: nil, rows: held.map(cells.ranked)
        )])
        carriesGap = rows.contains { $0.gap != nil }
    }

    /// A view at the order's clock: the order's rows, then its players on a season-long list, after
    /// them in All and under the list's head in a position's view, as the run's view draws them.
    /// A position's held head sits over the rows on a season-long list alone; the other unplaced rows
    /// follow with no head (Lane 243 fix round 1, M1: a row on no list never sits under it).
    static func atClock(_ rows: [BoardRow], listed: [BoardRow], position: BoardPosition?) -> [BoardSection] {
        guard let position else {
            return [BoardSection(id: "all", head: nil, band: nil, rows: rows + listed)]
        }
        let held = listed.filter { $0.status?.onList == true }
        let others = listed.filter { $0.status?.onList != true }
        return [BoardSection(id: position.rawValue, head: nil, band: nil, rows: rows)]
            + (held.isEmpty ? [] : [BoardSection(
                id: "\(position.rawValue)-held", head: Words.Board.heldHead, band: nil, rows: held
            )])
            + (others.isEmpty ? [] : [BoardSection(
                id: "\(position.rawValue)-unplaced", head: nil, band: nil, rows: others
            )])
    }

    /// TierStrip.svelte's words for a tier.
    static func band(_ group: TierGroup, position: BoardPosition, unit: String) -> TierBand {
        TierBand(
            tier: group.tier,
            name: "\(Words.Tier.tier) \(group.tier)",
            count: Formatting.plural(group.rows.count, position.group.one, position.group.many),
            drop: group.drop.map { Formatting.fixed($0) },
            dropWords: group.drop == nil ? Words.Tier.lastTier : "\(unit) \(Words.Tier.toTier) \(group.tier + 1)"
        )
    }
}

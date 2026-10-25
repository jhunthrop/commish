import CommishAPI
import CommishDesign
import Foundation

/// A position view of the board, as the web's position chips name them (the defense DST, where the API
/// names it DEF). Kickers and defenses are listed in draft order, with no projection of ours.
public enum BoardPosition: String, CaseIterable, Sendable, Hashable {
    case quarterback = "QB"
    case runningBack = "RB"
    case receiver = "WR"
    case tightEnd = "TE"
    case kicker = "K"
    case defense = "DEF"

    public var label: String {
        self == .defense ? Words.Board.defense : rawValue
    }

    /// A kicker's or a defense's view: the drafts' order, no points of ours.
    var draftOrder: Bool {
        self == .kicker || self == .defense
    }

    init?(_ position: Components.Schemas.PlayerPosition) {
        guard let known = position.value1 else {
            return nil
        }
        self.init(rawValue: known.rawValue)
    }
}

/// What the chips have chosen: the scoring format and the view. Held by the screen's view model, so a
/// sheet opened over the board and closed again finds the same chips pressed.
public struct BoardFilter: Equatable, Hashable, Sendable {
    public let format: BoardFormat
    /// nil is the All view.
    public let position: BoardPosition?

    public init(format: BoardFormat = .ppr, position: BoardPosition? = nil) {
        self.format = format
        self.position = position
    }

    public func with(format: BoardFormat) -> BoardFilter {
        BoardFilter(format: format, position: position)
    }

    public func with(position: BoardPosition?) -> BoardFilter {
        BoardFilter(format: format, position: position)
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

/// One player's row as the web's board row draws it at 390 (Row.svelte): his name the biggest thing,
/// his position pill with his rank there (or the list he is on), his club and bye under it, his
/// status chip, then the view's figures.
public struct BoardRow: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let initials: String
    /// "WR 4", "RB IR", "DST 1".
    public let pill: String
    public let club: String
    /// "Bye 6"; nil when his club has none (a free agent).
    public let bye: String?
    public let status: RowStatus?
    /// His projected points, the row's one big number; the empty figure for a kicker or a defense.
    public let projected: String
    /// Over replacement, signed.
    public let overReplacement: String
    public let gap: String
    public let gapTone: GapTone?
    /// A kicker's or a defense's place in the drafts' order.
    public let draftOrder: String
    public let adp: String
    /// The player his row opens in the sheet; nil where the site has no page for him.
    public let sheetPlayer: SheetPlayer?
}

/// A run of rows under an optional head: a view's players, then a position's players on a season-long
/// list under theirs.
public struct BoardSection: Equatable, Sendable, Identifiable {
    public let id: String
    public let head: String?
    public let rows: [BoardRow]
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

/// The Board screen as the web's board says it at 390, from the API's board (GET /boards/{format}):
/// the heading and the one verb for the season, the format and position chips, the view's rows in our
/// order with each position number the API's own, and the basis once.
public struct BoardModel: Equatable, Sendable {
    public let words: BoardWords
    public let formats: [BoardChip<BoardFormat>]
    public let positions: [BoardChip<BoardPosition?>]
    public let columns: BoardColumns
    public let sections: [BoardSection]
    /// What the numbers are, then the capture the statuses come from.
    public let basis: [String]

    public var rows: [BoardRow] {
        sections.flatMap(\.rows)
    }

    /// `inSeason` is the rail's season; `following` whether the member follows a league.
    public init(board: RoomBoard, filter: BoardFilter, inSeason: Bool, following: Bool, now: Date, zone: TimeZone) {
        let label = BoardModel.label(filter.format)
        words = BoardWords.of(
            inSeason: inSeason,
            cover: BoardCover(
                season: board.season, label: label, position: filter.position?.label, restOfSeason: inSeason
            ),
            following: following
        )
        formats = BoardFormat.allCases.map {
            BoardChip(label: BoardModel.label($0), value: $0, pressed: $0 == filter.format)
        }
        let present = Set(board.players.compactMap { BoardPosition($0.position) })
        positions = [BoardChip(label: Words.Board.all, value: nil, pressed: filter.position == nil)]
            + BoardPosition.allCases.filter(present.contains).map {
                BoardChip(label: $0.label, value: $0, pressed: $0 == filter.position)
            }
        let pages = PlayerPages.unshared(board.players.map(\.name))
        let cells = { (player: BoardPlayer) in BoardModel.row(player, pages: pages, zone: zone) }
        sections = BoardOrder.sections(board.players, position: filter.position).map { section in
            BoardSection(id: section.id, head: section.head, rows: section.players.map(cells))
        }
        let shown = sections.flatMap(\.rows)
        columns = filter.position?.draftOrder == true
            ? .draftOrder
            : .ranked(gap: !inSeason && shown.contains { $0.gapTone != nil })
        basis = [board.basis] + (board.statusRead.map {
            BoardWords.capture(asOf: $0.asOf, checkedAt: $0.checkedAt, now: now, zone: zone)
        }.map { [$0] } ?? [])
    }

    /// A format's chip (board-words.ts BOARD_FORMAT_WORDS).
    public static func label(_ format: BoardFormat) -> String {
        switch format {
        case .ppr: Words.BoardFormat.ppr
        case .half: Words.BoardFormat.half
        case .std: Words.BoardFormat.std
        }
    }

    static func row(_ player: BoardPlayer, pages: Set<String>, zone: TimeZone) -> BoardRow {
        let position = BoardPosition(player.position)
        let label = position?.label ?? player.position.value2 ?? ""
        let status = boardStatus(player.status, zone: zone)
        let rank = status?.rank ?? String(player.positionRank)
        let slug = PlayerPages.slug(player.name)
        let paged = position.map { !$0.draftOrder } == true && pages.contains(slug)
        // A player on a season-long list: his rank is the word, so no gap (Row.svelte heldOut).
        let gap = status?.onList == true ? nil : player.gap
        return BoardRow(
            id: player.id,
            name: player.name,
            initials: Initials.of(player.name),
            pill: "\(label) \(rank)",
            club: player.team,
            bye: player.bye.map { "\(Words.Board.bye) \($0)" },
            status: status,
            projected: BoardFigures.projected(player.points),
            overReplacement: player.vor.map(BoardFigures.signed) ?? Words.Box.none,
            gap: BoardFigures.gap(gap),
            gapTone: GapTone(gap),
            draftOrder: String(player.positionRank),
            adp: player.adp.map { Formatting.fixed($0) } ?? Words.Box.none,
            sheetPlayer: paged ? SheetPlayer(
                id: player.id, slug: slug, name: player.name, position: label, rank: rank, club: player.team
            ) : nil
        )
    }

    /// His status as the board row's chip says it (status-view.ts statusView): a season-long list's
    /// word in place of his rank and its start, or the week's designation.
    static func boardStatus(_ status: Components.Schemas.BoardStatus?, zone: TimeZone) -> RowStatus? {
        guard let status, let known = status.status.value1 else {
            return nil
        }
        guard RowStatuses.seasonLong(known, flagged: status.seasonLong) else {
            return RowStatus(
                rank: nil, mark: RowStatuses.word(known), sits: RowStatuses.sits(known),
                question: known == .questionable
            )
        }
        return RowStatus(
            rank: RowStatuses.rankWord(known),
            mark: RowStatuses.seasonLongMark(known, since: status.since, returning: nil, zone: zone),
            sits: true, question: false
        )
    }
}

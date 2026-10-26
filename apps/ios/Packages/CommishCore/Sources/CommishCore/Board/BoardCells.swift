import CommishAPI
import CommishDesign
import Foundation

/// A run row's cells as the phone prints them.
struct BoardCells {
    let statuses: BoardOrder.Statuses
    /// Each club's bye by its abbreviation, nil where the run names none (server/run.ts clubByes).
    let byes: [String: Int]
    /// The week a rest-of-season board ranks from; nil on a board of the full season.
    let fromWeek: Int?
    let zone: TimeZone

    static func byes(_ clubs: [RunClub]) -> [String: Int] {
        Dictionary(
            clubs.compactMap { club in club.bye.map { (club.abbr, $0) } },
            uniquingKeysWith: { first, _ in first }
        )
    }

    /// Row.svelte's phone bye with format/bye.ts byeCell: "Bye 11", "Bye Done" for a bye before the
    /// week the board ranks from.
    func bye(_ club: String) -> String? {
        byes[club].map { week in
            "\(Words.Board.bye) \(fromWeek.map { week < $0 } == true ? Words.Bye.done : String(week))"
        }
    }

    func ranked(_ row: RunBoardRow) -> BoardRow {
        ranked(row, figures: row.figures)
    }

    /// His row with the figures of one clock: the run's, or the order's put on his run row
    /// (LiveOrder), every figure and his place at his position from the same one.
    func ranked(_ row: RunBoardRow, figures: PlacedFigures) -> BoardRow {
        let position = BoardPosition(rawValue: row.positionName)
        let label = position?.label ?? row.positionName
        let status = statuses[row.id].flatMap { BoardStatus.view($0, zone: zone) }
        let rank = status?.rank ?? String(figures.positionRank)
        // A player on a season-long list: his rank is the word, so no gap (Row.svelte heldOut).
        let gap = status?.onList == true ? nil : figures.gap
        return BoardRow(
            id: row.id,
            name: row.name,
            initials: Initials.of(row.name),
            headshot: Self.face(row.headshot),
            pill: "\(label) \(rank)",
            club: row.team,
            bye: bye(row.team),
            status: status,
            projected: BoardFigures.projected(figures.projected),
            overReplacement: BoardFigures.signed(figures.vor),
            heat: Heat.of(vor: figures.vor, round: figures.vorRound),
            gap: BoardFigures.gap(gap),
            gapTone: GapTone(gap),
            draftOrder: String(figures.positionRank),
            adp: row.adp.map { Formatting.fixed($0) } ?? Words.Box.none,
            sheetPlayer: SheetPlayer(
                id: row.id, slug: row.slug, name: row.name, position: label, rank: rank, club: row.team,
                boardID: row.id
            )
        )
    }

    /// A player on a season-long list at the order's clock: the list's word in his pill and no figure,
    /// as the Rankings draw him (the order values none for him, and the run's are another clock's).
    func listed(_ row: RunBoardRow) -> BoardRow {
        let drawn = ranked(row)
        return BoardRow(
            id: drawn.id, name: drawn.name, initials: drawn.initials, headshot: drawn.headshot, pill: drawn.pill,
            club: drawn.club, bye: drawn.bye, status: drawn.status, projected: Words.Box.none,
            overReplacement: Words.Box.none, heat: .none, gap: Words.Box.none, gapTone: nil,
            draftOrder: drawn.draftOrder, adp: drawn.adp, sheetPlayer: drawn.sheetPlayer
        )
    }

    /// A kicker or a defense: on the board his place is his Draft order column, so his pill is his
    /// position alone (Row.svelte pillRank) or his list's word; where no Draft order column is drawn
    /// (ADP, `placed`) the pill carries his place. The site has no page of his to open.
    func market(_ row: RunMarketRow, placed: Bool = false) -> BoardRow {
        let label = BoardPosition(rawValue: row.positionName)?.label ?? row.positionName
        let status = statuses[row.id].flatMap { BoardStatus.view($0, zone: zone) }
        let place = status?.rank ?? (placed ? String(row.positionRank) : nil)
        return BoardRow(
            id: row.id,
            name: row.name,
            initials: Initials.of(row.name),
            headshot: row.headshot.flatMap(Self.face),
            pill: [label, place].compactMap(\.self).joined(separator: " "),
            club: row.team,
            bye: bye(row.team),
            status: status,
            projected: Words.Box.none,
            overReplacement: Words.Box.none,
            heat: .none,
            gap: Words.Box.none,
            gapTone: nil,
            draftOrder: String(row.positionRank),
            adp: Formatting.fixed(row.adp),
            sheetPlayer: nil
        )
    }

    /// His face where the run gives an https address.
    static func face(_ address: String) -> URL? {
        URL(string: address).flatMap { $0.scheme == "https" ? $0 : nil }
    }
}

/// His status as the board row's chip says it (status-view.ts statusView): a season-long list's word in
/// place of his rank and its start, a week's designation, or due back this week.
enum BoardStatus {
    static func view(_ status: RunPlayerStatus, zone: TimeZone) -> RowStatus? {
        guard let known = status.status.value1 else {
            return nil
        }
        if status.seasonLong {
            return RowStatus(
                rank: RowStatuses.rankWord(known),
                mark: RowStatuses.seasonLongMark(known, since: status.since, returning: status.returning, zone: zone),
                sits: true, question: false
            )
        }
        let mark = status.returning.map { "Due back \(RowStatuses.calendarDay($0, weekday: true))" }
            ?? RowStatuses.word(known)
        return RowStatus(rank: nil, mark: mark, sits: RowStatuses.sits(known), question: known == .questionable)
    }
}

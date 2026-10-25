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
        let position = BoardPosition(rawValue: row.positionName)
        let label = position?.label ?? row.positionName
        let status = statuses[row.id].flatMap { BoardStatus.view($0, zone: zone) }
        let rank = status?.rank ?? String(row.positionRank)
        // A player on a season-long list: his rank is the word, so no gap (Row.svelte heldOut).
        let gap = status?.onList == true ? nil : row.gap
        return BoardRow(
            id: row.id,
            name: row.name,
            initials: Initials.of(row.name),
            headshot: Self.face(row.headshot),
            pill: "\(label) \(rank)",
            club: row.team,
            bye: bye(row.team),
            status: status,
            projected: BoardFigures.projected(row.projected),
            overReplacement: BoardFigures.signed(row.vor),
            heat: Heat.of(vor: row.vor, round: row.vorRound),
            gap: BoardFigures.gap(gap),
            gapTone: GapTone(gap),
            draftOrder: String(row.positionRank),
            adp: row.adp.map { Formatting.fixed($0) } ?? Words.Box.none,
            sheetPlayer: SheetPlayer(
                id: row.id, slug: row.slug, name: row.name, position: label, rank: rank, club: row.team,
                boardID: row.id
            )
        )
    }

    /// A kicker or a defense: his place is his Draft order column, so his pill is his position alone
    /// (Row.svelte pillRank) or his list's word; the site has no page of his to open.
    func market(_ row: RunMarketRow) -> BoardRow {
        let label = BoardPosition(rawValue: row.positionName)?.label ?? row.positionName
        let status = statuses[row.id].flatMap { BoardStatus.view($0, zone: zone) }
        return BoardRow(
            id: row.id,
            name: row.name,
            initials: Initials.of(row.name),
            headshot: row.headshot.flatMap(Self.face),
            pill: [label, status?.rank].compactMap(\.self).joined(separator: " "),
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

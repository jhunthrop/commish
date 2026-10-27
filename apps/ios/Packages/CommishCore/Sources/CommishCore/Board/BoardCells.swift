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

    /// Row.svelte's phone bye (bye.ts byeLine): "Bye week 11" while ahead of the week the board ranks
    /// from, nothing once played (Lane 223, B190).
    func bye(_ club: String) -> String? {
        Byes.line(byes[club], fromWeek: fromWeek)
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
            ),
            clubMark: false
        )
    }

    /// A row the order places at its clock, with the order's figures: his status the order's own row's
    /// first (`said`), else the run's (Lane 243 fix round 1, M2), and a season-long list's word in his
    /// rank's place, as the web's Rankings say such a row (order.ts orderView's # cell,
    /// `listed ? box.status.rank`).
    func placed(_ row: RunBoardRow, figures: PlacedFigures, said: HeldStatus?) -> BoardRow {
        let drawn = ranked(row, figures: figures)
        guard let status = said?.status else {
            return drawn
        }
        let label = BoardPosition(rawValue: row.positionName)?.label ?? row.positionName
        let rank = status.rank ?? String(figures.positionRank)
        let gap = status.onList ? nil : figures.gap
        return BoardRow(
            id: drawn.id, name: drawn.name, initials: drawn.initials, headshot: drawn.headshot,
            pill: "\(label) \(rank)", club: drawn.club, bye: drawn.bye, status: status,
            projected: drawn.projected, overReplacement: drawn.overReplacement, heat: drawn.heat,
            gap: BoardFigures.gap(gap), gapTone: GapTone(gap), draftOrder: drawn.draftOrder, adp: drawn.adp,
            sheetPlayer: SheetPlayer(
                id: row.id, slug: row.slug, name: row.name, position: label, rank: rank, club: row.team,
                boardID: row.id
            ),
            clubMark: drawn.clubMark
        )
    }

    /// A player drawn after the order's ranked rows at its clock: one on a season-long list, or one the
    /// order holds with no figure (Lane 243, B251). His status's word in his pill (`said`: the order's
    /// own row's, else the run's; "--" with neither) and no figure, as the Rankings draw him (the order
    /// values none for him, and the run's are another clock's).
    func listed(_ row: RunBoardRow, said: HeldStatus?) -> BoardRow {
        let drawn = ranked(row)
        let label = BoardPosition(rawValue: row.positionName)?.label ?? row.positionName
        let word = said?.word ?? Words.Box.none
        return BoardRow(
            id: drawn.id, name: drawn.name, initials: drawn.initials, headshot: drawn.headshot,
            pill: "\(label) \(word)", club: drawn.club, bye: drawn.bye, status: said?.status,
            projected: Words.Box.none, overReplacement: Words.Box.none, heat: .none, gap: Words.Box.none,
            gapTone: nil, draftOrder: drawn.draftOrder, adp: drawn.adp,
            sheetPlayer: SheetPlayer(
                id: row.id, slug: row.slug, name: row.name, position: label, rank: word, club: row.team,
                boardID: row.id
            ),
            clubMark: drawn.clubMark
        )
    }

    /// The run's status for a row drawn after the order's, with its short word; nil where the run lists
    /// none.
    func held(_ id: String) -> HeldStatus? {
        guard let status = statuses[id], let view = BoardStatus.view(status, zone: zone),
              let known = status.status.value1
        else {
            return nil
        }
        return HeldStatus(status: view, word: view.rank ?? RowStatuses.rankWord(known))
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
            sheetPlayer: nil,
            clubMark: BoardPosition(rawValue: row.positionName) == .defense && !row.team.isEmpty
        )
    }

    /// His face where the run gives an https address.
    static func face(_ address: String) -> URL? {
        URL(string: address).flatMap { $0.scheme == "https" ? $0 : nil }
    }
}

/// What a row drawn after the order's ranked rows says of his status: the chip, and the short word his
/// pill carries in his rank's place ("IR", "O").
struct HeldStatus: Equatable, Sendable {
    let status: RowStatus
    let word: String

    /// The status the order's own row carries (box.ts statusOf), nil with none.
    static func of(_ line: PlayerLine, zone: TimeZone) -> HeldStatus? {
        let designation = line.facts.designation?.value1
        let hostIR = line.player.injuredReserve
        guard let status = RowStatuses.of(designation, hostIR: hostIR, zone: zone),
              let word = status.rank ?? RowStatuses.rankWord(of: designation, hostIR: hostIR)
        else {
            return nil
        }
        return HeldStatus(status: status, word: word)
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

/// The order's places for a board of `teams`, every row it returned by board id, placed or not, and
/// whether its answer is cut (it holds more players than it returned).
struct ClockPlaces {
    let places: [String: LivePlace]
    let teams: Int
    let rows: [String: OrderRow]
    let cut: Bool
    let zone: TimeZone

    /// The status the order's own row carries for a board id, nil with none or no row.
    func said(_ id: String) -> HeldStatus? {
        rows[id].flatMap { HeldStatus.of($0.line, zone: zone) }
    }

    /// The order's places for the board `format`, nil for an answer in another scoring.
    init?(_ order: OrderAtClock, format: RunFormat, zone: TimeZone) {
        guard LiveOrder.inScoring(order.answer, format: format) else {
            return nil
        }
        places = order.places
        teams = format.teams
        rows = order.rows
        cut = LiveOrder.cut(order.answer)
        self.zone = zone
    }
}

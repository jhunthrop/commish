import CommishAPI
import Foundation

/// The clubs at the order's clock (Lane 224, the web's Lane 220): the order's places for a club's
/// board, the basis on its rows' clock, and each club card's lead at the order's clock.
extension ClubFiles {
    /// The order's places when the run ranks the rest of the season and the order is in the board's
    /// scoring; nil before the season, while unread, or in another scoring.
    func places(_ order: OrderAtClock?) -> [String: LivePlace]? {
        guard let order, format.rosFromWeek != nil, LiveOrder.inScoring(order.answer, format: format) else {
            return nil
        }
        return order.places
    }

    /// A page's basis on its clock: the order's lead in the board sentence's place once its rows stand,
    /// else in season the run's stamp after the whole basis.
    func basis(_ run: [String], order: OrderAtClock?, atClock: Bool, zone: TimeZone) -> [String] {
        guard format.rosFromWeek != nil else {
            return run
        }
        return LiveOrder.basis(
            run, board: BoardBasis.ourBoard(format, season: manifest.value.season),
            lead: atClock ? order?.lead(teams: format.teams, zone: zone) : nil,
            stamp: LiveOrderWords.runStamp(format, zone: zone)
        )
    }
}

extension ClubsModel {
    /// A club's first players on the board, its card's lead's pool at the order's clock
    /// (server/pages/clubs.ts CLUB_LEAD_POOL).
    static let leadPool = 3

    /// Each club's lead with his figures: the first of its rows on no season-long list, whose rank
    /// assumes he plays (held-places.ts leadOf), the run's; at the order's clock the first of its pool so
    /// placed, with the order's figures, when the order places every club's pool (placedLeads), else
    /// every lead the run's.
    static func leads(
        _ clubs: [RunClub], ordered: [RunBoardRow], files: ClubFiles, places: [String: LivePlace]?
    ) -> (byClub: [String: (RunBoardRow, PlacedFigures)], atClock: Bool) {
        let available = { (row: RunBoardRow) in !BoardOrder.heldOut(row, files.statuses) }
        let run = Dictionary(uniqueKeysWithValues: clubs.compactMap { club in
            ordered.first { $0.team == club.abbr && available($0) }.map { (club.abbr, ($0, $0.figures)) }
        })
        guard let places else {
            return (run, false)
        }
        var placed: [String: (RunBoardRow, PlacedFigures)] = [:]
        for club in clubs where run[club.abbr] != nil {
            let pool = Array(ordered.filter { $0.team == club.abbr }.prefix(leadPool))
            guard let pooled = LiveOrder.placed(pool, id: \.id, places: places) else {
                return (run, false)
            }
            placed[club.abbr] = pooled.first { available($0.row) }.map {
                ($0.row, $0.row.figures.at($0.place, teams: files.format.teams))
            }
        }
        return (placed, true)
    }
}

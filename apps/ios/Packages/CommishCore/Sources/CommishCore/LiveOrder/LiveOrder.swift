import CommishAPI
import Foundation

/// A player's place in the order at the read's clock (web/src/lib/run/live-order.ts LivePlace).
public struct LivePlace: Equatable, Sendable {
    public let rank: Int
    /// Nil for a player on a season-long list, whose run row says the list's word.
    public let positionRank: Int?
    public let projected: Double
    public let vor: Double

    public init(rank: Int, positionRank: Int?, projected: Double, vor: Double) {
        self.rank = rank
        self.positionRank = positionRank
        self.projected = projected
        self.vor = vor
    }
}

/// The figures a run row ranks and scores a player by, on one clock: the run's, or the order's put on
/// the run's row (live-order.ts placedAt).
struct PlacedFigures: Equatable, Sendable {
    let ourRank: Int
    let positionRank: Int
    let projected: Double
    let vor: Double
    let vorRound: Int
    /// The run's Gap is its ADP less its own rank, so the order's place leaves it unsaid.
    let gap: Double?

    /// The order's rank, place, points and value, and the round a `teams`-team draft his place falls in;
    /// a listed player keeps the run's place at his position (his row says the list's word).
    func at(_ place: LivePlace, teams: Int) -> PlacedFigures {
        place.figures(teams: teams, runPositionRank: positionRank)
    }
}

extension LivePlace {
    /// His figures at the read's clock on a board of `teams`: a listed player keeps the run's place at
    /// his position, `runPositionRank` (his row says the list's word).
    func figures(teams: Int, runPositionRank: Int) -> PlacedFigures {
        PlacedFigures(
            ourRank: rank, positionRank: positionRank ?? runPositionRank, projected: projected, vor: vor,
            vorRound: Int((Double(rank) / Double(teams)).rounded(.up)), gap: nil
        )
    }
}

extension RunBoardRow {
    var figures: PlacedFigures {
        PlacedFigures(
            ourRank: ourRank, positionRank: positionRank, projected: projected, vor: vor, vorRound: vorRound, gap: gap
        )
    }
}

/// The order at a screen's clock, as every in-season screen reads it (Lane 224, from the web's Lane 220,
/// B184): the run is our rest-of-season board at the nightly's instant and the API's order the same
/// board at the read's clock, a club's games kicked off since taken out. Once the season is under way a
/// screen that ranks or scores a player prints the order's figures, the ones the Rankings read; a screen
/// whose rows the answer does not all place keeps the run's, every row, so no table mixes the two
/// clocks. Pure, so the tests read every figure a screen prints.
public enum LiveOrder {
    /// Each player the answer places with both figures, by board id (livePlaces).
    public static func places(_ answer: OrderAdvice) -> [String: LivePlace] {
        var places: [String: LivePlace] = [:]
        for row in answer.rows {
            guard let id = row.line.player.boardId, let projected = row.restOfSeasonPoints,
                  let vor = row.pointsOverReplacement
            else {
                continue
            }
            places[id] = LivePlace(
                rank: row.rank, positionRank: row.line.positionRank, projected: projected, vor: vor
            )
        }
        return places
    }

    /// Every row the answer returns, by board id, with figures or without: a row with none (a player
    /// put on a list after the nightly) is still the order's, drawn with its status's word (Lane 243,
    /// B251).
    public static func rows(_ answer: OrderAdvice) -> [String: OrderRow] {
        Dictionary(
            answer.rows.compactMap { row in row.line.player.boardId.map { ($0, row) } },
            uniquingKeysWith: { first, _ in first }
        )
    }

    /// Whether the answer is cut: the view holds more players than the rows it returned (its limit).
    public static func cut(_ answer: OrderAdvice) -> Bool {
        answer.total > answer.rows.count
    }

    /// live-order.ts omittedFromRun (Lane 280, B257): the run's players, in the run's order, an uncut
    /// answer does not return, drawn from the run and counted once; none on a cut answer, whose limit
    /// omits them.
    public static func omittedFromRun(_ runIds: [String], returned: Set<String>, cut: Bool) -> [String] {
        cut ? [] : runIds.filter { !returned.contains($0) }
    }

    /// Every row with its place, in the order's order, or nil when the answer does not place one of
    /// them: the screen then keeps the run's rows, never a table half one board and half the other
    /// (placedRows).
    static func placed<Row>(
        _ rows: [Row], id: (Row) -> String, places: [String: LivePlace]
    ) -> [(row: Row, place: LivePlace)]? {
        var out: [(row: Row, place: LivePlace)] = []
        for row in rows {
            guard let place = places[id(row)] else {
                return nil
            }
            out.append((row, place))
        }
        return out.enumerated()
            .sorted { ($0.element.place.rank, $0.offset) < ($1.element.place.rank, $1.offset) }
            .map(\.element)
    }

    /// Whether the order's answer is in the board format's scoring (inScoring): the public order is
    /// PPR, so a screen whose board is in another scoring, or a format with no API name, never draws it.
    public static func inScoring(_ answer: OrderAdvice, format: RunFormat) -> Bool {
        let scoring = answer.projectionScoring.format
        return format.apiFormat.map { $0 == (scoring.value1?.rawValue ?? scoring.value2) } ?? false
    }

    /// The places Compare draws its pair from (placedPair): the order's, only in the board's own format
    /// (the one the order is read in) and only when it places both players; else none, and both sides
    /// keep the run's, never one side of each.
    static func pair(
        _ ids: [String], places: [String: LivePlace]?, format: String, boardFormat: String?
    ) -> [String: LivePlace]? {
        guard let places, format == boardFormat, ids.allSatisfy({ places[$0] != nil }) else {
            return nil
        }
        return places
    }

    /// A screen's basis on the clock its rows are on (basisAtClock): the order's lead in place of the
    /// run's board sentence once the order's rows stand, led by it where the basis names no board;
    /// before it answers, or when it fails, the run's basis with the run's stamp after it.
    static func basis(_ run: [String], board: String?, lead: String?, stamp: String?) -> [String] {
        guard let lead else {
            return run + (stamp.map { [$0] } ?? [])
        }
        guard let board, let index = run.firstIndex(of: board) else {
            return [lead] + run
        }
        var said = run
        said[index] = lead
        return said
    }
}

extension RunFormat {
    /// format-ids.ts apiFormatOf: the API's name for a run format at the default league size ("half_ppr"
    /// for "half-ppr-12"), nil for any other size.
    var apiFormat: String? {
        let suffix = "-\(CardTiles.defaultTeams)"
        guard teams == CardTiles.defaultTeams, id.hasSuffix(suffix) else {
            return nil
        }
        return String(id.dropLast(suffix.count)).replacingOccurrences(of: "-", with: "_")
    }
}

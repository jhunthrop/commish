import CommishAPI
@testable import CommishCore
import Foundation

/// The shared fixtures (shared/fixtures), the same answers the web's tests and shots read, and the
/// web's own readers' output over them (shared/fixtures/parity).
enum Fixtures {
    static let league = "6f1d1c52-2626-4a26-9a26-000000000026"
    static let zone = TimeZone(identifier: "America/Chicago")!

    /// The fixture clocks by their file names.
    static let week = "2026-10-17T17-00-00Z"
    static let sunday = "2026-10-18T18-56-00Z"
    static let tuesday = "2026-10-20T17-00-00Z"

    static let shared = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("../../../../../../shared")
        .standardized

    static func data(_ path: String) throws -> Data {
        try Data(contentsOf: shared.appendingPathComponent(path))
    }

    static func sync() throws -> LeagueSync {
        try APIDecoding.envelopeData(LeagueSync.self, from: data("fixtures/inseason/leagues-attached-\(league).json"))
    }

    static func scoreboard(_ clock: String) throws -> Scoreboard {
        try APIDecoding.envelopeData(
            Scoreboard.self,
            from: data("fixtures/inseason/scoreboard-\(league)-\(clock).json")
        )
    }

    /// The member's lineup at a clock (GET /leagues/attached/{id}/lineup).
    static func lineup(_ clock: String) throws -> LineupAdvice {
        try APIDecoding.envelopeData(LineupAdvice.self, from: data("fixtures/inseason/lineup-\(league)-\(clock).json"))
    }

    /// The league read at a clock, its matchup's score as then (GET /leagues/attached/{id}/sync).
    static func matchupSync(_ clock: String) throws -> LeagueSync {
        try APIDecoding.envelopeData(LeagueSync.self, from: data("fixtures/inseason/sync-\(league)-\(clock).json"))
    }

    /// The week's matchup as a box score at a clock (GET /leagues/attached/{id}/matchup).
    static func matchupBox(_ clock: String) throws -> MatchupBox {
        try APIDecoding.envelopeData(MatchupBox.self, from: data("fixtures/inseason/matchup-\(league)-\(clock).json"))
    }

    /// Another team's game at a clock (Lane 206), as the Sleeper league reads it: its box asked by
    /// roster 2 (GET .../matchup?roster=2), the league read and the scoreboard it is drawn with.
    static func otherGame(_ clock: String) throws -> MatchupAnswer {
        let file = { (name: String) in try data("fixtures/inseason/\(name)-\(clock).json") }
        return try MatchupAnswer(
            sync: APIDecoding.envelopeData(LeagueSync.self, from: file("sync-\(league)-sleeper")),
            box: APIDecoding.envelopeData(MatchupBox.self, from: file("matchup-\(league)-roster-2")),
            board: APIDecoding.envelopeData(Scoreboard.self, from: file("scoreboard-\(league)-sleeper"))
        )
    }

    /// The trade finder at a clock (GET /leagues/attached/{id}/trades).
    static func trades(_ clock: String) throws -> TradeAdvice {
        try APIDecoding.envelopeData(TradeAdvice.self, from: data("fixtures/inseason/trades-\(league)-\(clock).json"))
    }

    /// The check of the strip's trade `number` at a clock (POST /leagues/attached/{id}/trades/check).
    static func tradeCheck(_ clock: String, _ number: Int) throws -> TradeCheck {
        try APIDecoding.envelopeData(
            TradeCheck.self, from: data("fixtures/inseason/trade-check-\(league)-\(clock)-\(number).json")
        )
    }

    /// The players free to add in a league at a clock (GET /leagues/attached/{id}/waivers).
    static func waivers(_ id: String, _ clock: String) throws -> WaiverAdvice {
        try APIDecoding.envelopeData(WaiverAdvice.self, from: data("fixtures/inseason/waivers-\(id)-\(clock).json"))
    }

    /// A claim's plan or its outcome on an ESPN stand-in (POST .../moves/plan, POST .../moves).
    static func claim<T: Decodable>(_ type: T.Type, _ file: String) throws -> T {
        try APIDecoding.envelopeData(type, from: data("fixtures/inseason/\(file)"))
    }

    /// A file clock as its instant: `2026-10-18T18-56-00Z` as 18:56 UTC that day.
    static func instant(_ clock: String) -> Date {
        let text = clock.replacingOccurrences(
            of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
        )
        return APIDecoding.parseDate(text)!
    }

    static func parity() throws -> Parity {
        try JSONDecoder().decode(Parity.self, from: data("fixtures/parity/league-home.json"))
    }
}

/// shared/fixtures/parity/league-home.json, as the web's readers wrote it.
struct Parity: Decodable {
    struct Side: Decodable, Equatable {
        let name: String
        let record: String
        let me: Bool
        let small: String
        let big: String
        let toPlay: String
        let stands: String
    }

    struct Bug: Decodable, Equatable {
        let mine: Bool
        let state: String
        let head: String
        let words: String
        let small: String
        let big: String
        let sides: [Side]
    }

    struct Standing: Decodable, Equatable {
        let rank: Int
        let team: String
        let record: String
        let pointsFor: String
        let pointsAgainst: String
        let streak: String
        let waiver: String
        let proj: String
        let me: Bool
    }

    struct Home: Decodable {
        let now: String
        let bugs: [Bug]
        let standings: [Standing]
        let teamBasis: String
        let phoneBasis: String
    }

    struct Player: Decodable, Equatable {
        let name: String
        let position: String
        let club: String
        let to: String?
    }

    struct Move: Decodable, Equatable {
        let when: String
        let kind: String
        let teams: [String]
        let adds: [Player]
        let drops: [Player]
        let detail: String
        let mine: Bool
    }

    struct Rule: Decodable, Equatable {
        let after: Int
        let words: String
    }

    let zone: String
    let clocks: [String: Home]
    let moves: [Move]
    let playoffRule: Rule?
    let seeding: String?
    let standingsBasis: String
}

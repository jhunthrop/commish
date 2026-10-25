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

    /// The API's PPR board (GET /boards/ppr), as a dev API answered it.
    static func board() throws -> RoomBoard {
        try APIDecoding.envelopeData(RoomBoard.self, from: data("fixtures/inseason/boards-ppr.json"))
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

import Foundation
import RunFixtures

/// shared/fixtures/parity/reference.json as the reference screens' parity tests read it.
extension ReferenceParityTests {
    struct Parity: Decodable {
        let runs: [Run]
    }

    struct Run: Decodable {
        let fixture: String
        let now: String
        let underway: Bool
        let played: PlayedCase
        let adp: [AdpCase]
        let compare: CompareCases
        let clubs: ClubsCase
        let clubPages: [ClubPageCase]
        let schedule: ScheduleCase

        var run: RunFixture {
            fixture.hasSuffix("standin-run") ? .standIn : .contract
        }
    }

    struct PlayedCase: Decodable {
        struct Partial: Decodable {
            let week: Int
            let days: [String]
            let games: Int
        }

        let complete: Int
        let partial: Partial?
    }

    struct AdpCase: Decodable {
        struct Row: Decodable {
            let id: String
            let adp: String
            let rank: String
            let gap: String
            let heat: String?
        }

        let format: String
        let gap: Bool
        let rows: [Row]
        let basis: [String]
        let sourcesOnly: [String]
        let noAdp: [String]
    }

    struct CompareCases: Decodable {
        struct Steps: Decodable {
            let none: String
            let one: String
        }

        let steps: Steps
        let basis: [String: [String]]
        let pairs: [PairCase]
        let held: [PairCase]
    }

    struct PairCase: Decodable {
        struct Row: Decodable {
            struct Cell: Decodable {
                let text: String
                let wins: Bool?
                let tone: String?
            }

            let label: String
            let range: Bool
            let cells: [Cell]
        }

        let first: String
        let second: String
        let format: String
        let kind: String
        let leader: String?
        let call: String?
        let evidence: String?
        let rows: [Row]?
        let basis: [String]?
        let held: String?

        enum CodingKeys: String, CodingKey {
            case first = "a"
            case second = "b"
            case format, kind, leader, call, evidence, rows, basis, held
        }
    }

    struct Figure: Decodable, Equatable {
        let value: String
        let caption: String
    }

    struct ClubsCase: Decodable {
        struct Card: Decodable {
            let abbr: String
            let name: String
            let meta: String
            let strength: Figure?
            let lead: String?
            let players: String
        }

        let lead: String
        let clubs: [Card]
    }

    struct ClubPageCase: Decodable {
        struct Hero: Decodable {
            struct Hardest: Decodable {
                let figure: String
                let caption: String
            }

            let value: String
            let caption: String
            let note: String
            let hardest: Hardest
        }

        struct Game: Decodable {
            let week: Int
            let opponent: String
            let value: String
            let played: Bool
        }

        let abbr: String
        let hero: Hero?
        let scheduleCaption: String
        let games: [Game]
        let rows: [String]
        let market: [String]
        let gap: Bool
        let pair: [String]
        let basis: [String]
    }

    struct ScheduleCase: Decodable {
        struct Row: Decodable {
            struct Face: Decodable {
                let name: String
            }

            struct Cell: Decodable {
                let week: Int
                let opponent: String?
                let home: Bool
                let value: String
                let hard: Bool
                let played: Bool
            }

            let abbr: String
            let name: String
            let face: Face?
            let rank: Int?
            let strength: String?
            let cells: [Cell]
        }

        let season: Int
        let weeks: [Int]
        let lead: String
        let strengthLabel: String?
        let played: Int
        let rows: [Row]
        let legendHard: String
    }
}

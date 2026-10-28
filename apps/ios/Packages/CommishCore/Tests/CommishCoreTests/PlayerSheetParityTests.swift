import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The player sheet held to the web's shelf (shared/fixtures/parity/player-sheet.json): every held-read
/// case of the web's own tests, the status rule's at the build's clocks and its hourly passes, and each
/// sheet player at each fixture clock, his head, game cell, figures, basis lines and read exactly as
/// the shelf prints them.
struct PlayerSheetParityTests {
    struct Card: Decodable {
        let week: Int
        let scoring: String
        let points: Double?
        let state: String?
    }

    struct Shown: Decodable, Equatable {
        let withheld: Bool
        let body: String?
        let caption: String?
        let words: String?
    }

    struct ReadCase: Decodable {
        let name: String
        let read: RunWeekRead
        let card: Card?
        let shown: Shown
    }

    struct NoRead: Decodable {
        let state: String?
        let due: RunReadsDue?
        let words: String
    }

    struct StatusCase: Decodable {
        let name: String
        let read: RunWeekRead
        let capture: RunDesignations?
        let now: Date
        let id: String
        let built: RunWeekRead
    }

    struct Pass: Decodable {
        enum CodingKeys: String, CodingKey {
            case after
            case pass = "at"
        }

        let after: Date
        let pass: Date
    }

    struct Tile: Decodable, Equatable {
        let key: String
        let label: String
        let value: String
        let tone: String?
    }

    struct Weather: Decodable, Equatable {
        let glyph: String
        let words: String
    }

    struct Cell: Decodable, Equatable {
        let `where`: String
        let when: String
        let expected: String?
        let weather: Weather?
    }

    struct Head: Decodable, Equatable {
        let week: Int
        let opponent: String
    }

    struct SheetRead: Decodable, Equatable {
        let written: Bool
        let withheld: Bool?
        let body: String?
        let caption: String?
        let words: String?
    }

    struct Format: Decodable {
        let run: String
        let id: String
    }

    struct Sheet: Decodable {
        let player: String
        let clock: Date
        let league: Bool
        let format: Format
        let head: Head
        let cell: Cell?
        let tiles: [Tile]
        let basis: [String]
        let read: SheetRead
    }

    struct Parity: Decodable {
        let zone: String
        let weekRead: [ReadCase]
        let noRead: [NoRead]
        let statusHeld: [StatusCase]
        let nextPass: [Pass]
        let sheets: [Sheet]
    }

    static let parity: Parity = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../../../shared/fixtures/parity/player-sheet.json").standardized
        // swiftlint:disable:next force_try
        return try! APIDecoding.decoder().decode(Parity.self, from: Data(contentsOf: url))
    }()

    static func state(_ name: String?) -> GameRead? {
        switch name {
        case "upcoming": .upcoming
        case "kicked_off": .kickedOff
        case "final": .final
        default: nil
        }
    }

    static func shown(_ read: ShownRead) -> Shown {
        switch read {
        case let .written(body, caption): Shown(withheld: false, body: body, caption: caption, words: nil)
        case let .withheld(words): Shown(withheld: true, body: nil, caption: nil, words: words)
        }
    }

    @Test(arguments: parity.weekRead.indices)
    func everyHeldReadCaseShowsTheWebsWords(index: Int) {
        let test = Self.parity.weekRead[index]
        let card = test.card.map {
            CardProjection(week: $0.week, ppr: $0.scoring == "ppr", points: $0.points, state: Self.state($0.state))
        }
        #expect(Self.shown(WeekReads.shown(test.read, card: card)) == test.shown, "\(test.name)")
    }

    @Test func withNoReadThePlaceNamesHisNextGameOnlyWhileItIsToCome() {
        for test in Self.parity.noRead {
            #expect(
                WeekReads.noRead(Self.state(test.state), due: test.due) == test.words,
                "\(test.state ?? "none") \(test.due.map { "week \($0.week)" } ?? "no roll-over due")"
            )
        }
    }

    @Test(arguments: parity.statusHeld.indices)
    func aReadHisStatusMovedPastIsHeldAsTheWebHoldsIt(index: Int) {
        let test = Self.parity.statusHeld[index]
        let built = StatusHeld.read(test.read, capture: test.capture, player: test.id, now: test.now)
        #expect(built.body == test.built.body, "\(test.name)")
        #expect(built.caption == test.built.caption, "\(test.name)")
        #expect(built.call == test.built.call, "\(test.name)")
    }

    @Test func theNextHourlyPassFollowsTheCapturesSchedule() {
        for pass in Self.parity.nextPass {
            #expect(StatusHeld.nextHourlyPass(after: pass.after) == pass.pass, "\(pass.after)")
        }
    }

    @Test(arguments: parity.sheets.indices)
    func eachSheetPrintsWhatTheShelfPrints(index: Int) throws {
        let sheet = Self.parity.sheets[index]
        let run = sheet.format.run == "contract" ? RunFixture.contract : RunFixture.standIn
        let format = try #require(run.manifest().formats.first { $0.id == sheet.format.id })
        let clock = Fixtures.clockPart(sheet.clock)
        let week = sheet.league
            ? try WeekFixture.league(sheet.player, at: clock) : try WeekFixture.publicWeek(sheet.player, at: clock)
        let card = try PlayerCards.card(CardInput(
            week: week, page: RunFixture.standIn.page(id: sheet.player), format: format,
            season: run.manifest().season, capture: RunFixture.standIn.designations(), league: sheet.league,
            zone: #require(TimeZone(identifier: Self.parity.zone)), now: sheet.clock
        ))
        let name = "\(sheet.player) at \(clock)\(sheet.league ? "" : " with no league") on \(sheet.format.run)"
        #expect(card.head == CardHead(week: sheet.head.week, opponent: sheet.head.opponent), "\(name)")
        #expect(card.cell.map(Self.cell) == sheet.cell, "\(name)")
        #expect(card.tiles.map(Self.tile) == sheet.tiles, "\(name)")
        #expect(card.basis == sheet.basis, "\(name)")
        #expect(card.read.map(Self.read) == sheet.read, "\(name)")
    }

    static func cell(_ cell: NextCell) -> Cell {
        Cell(
            where: cell.place, when: cell.when, expected: cell.expected,
            weather: cell.weather.map { Weather(glyph: $0.glyph, words: $0.words) }
        )
    }

    static func tile(_ tile: CardTile) -> Tile {
        Tile(key: tile.key.rawValue, label: tile.label, value: tile.value, tone: tile.tone?.rawValue)
    }

    static func read(_ read: CommishCore.SheetRead) -> SheetRead {
        switch read {
        case let .none(words):
            return SheetRead(written: false, withheld: nil, body: nil, caption: nil, words: words)
        case let .shown(shown):
            let said = Self.shown(shown)
            return SheetRead(
                written: true, withheld: said.withheld, body: said.body, caption: said.caption, words: said.words
            )
        }
    }
}

extension Fixtures {
    /// An instant as a fixture file names it: 18:56 UTC on Oct 18 as `2026-10-18T18-56-00Z`.
    static func clockPart(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date).replacingOccurrences(of: ":", with: "-")
    }
}

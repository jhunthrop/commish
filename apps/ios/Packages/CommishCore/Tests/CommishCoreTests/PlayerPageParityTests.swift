import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The player page held to the web's (shared/fixtures/parity/player-sheet.json): every page of both
/// fixture runs, its big number's basis, where drafters take him, his value, his club, the read's stamp
/// and figures, the held tier and whether the run is under way; and the league verb's words for every
/// kind on every platform, Start him turning to the lineup once his game has kicked off.
struct PlayerPageParityTests {
    struct Words: Decodable, Equatable {
        let caption: String
        let draftersLabel: String
        let draftersFigure: String
        let drafters: String
        let value: String?
    }

    struct Figure: Decodable, Equatable {
        let label: String?
        let figure: String
        let caption: String
    }

    struct Page: Decodable {
        let run: String
        let player: String
        let format: String
        let underway: Bool
        let words: Words
        let figure: String
        let clubName: String
        let readStamp: String?
        let pulls: [Figure]
        let heldTier: String?
    }

    struct Verb: Decodable {
        let host: String
        let verb: PlayerVerb
        let label: String
        let external: Bool
        let note: String?
    }

    struct HeldVerb: Decodable {
        let player: String
        let clock: Date
        let kind: String
    }

    struct Parity: Decodable {
        let zone: String
        let pages: [Page]
        let verbs: [Verb]
        let heldVerbs: [HeldVerb]
    }

    static let parity: Parity = {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../../../shared/fixtures/parity/player-sheet.json").standardized
        // swiftlint:disable:next force_try
        return try! APIDecoding.decoder().decode(Parity.self, from: Data(contentsOf: url))
    }()

    static func input(_ page: Page) throws -> PageInput {
        let run = page.run == "contract" ? RunFixture.contract : RunFixture.standIn
        let board = try run.board(format: page.format)
        return try PageInput(
            source: .page(run.page(id: page.player)), manifest: run.manifest(), sources: run.adpSources(),
            capture: run.designations(), clubs: run.clubs(), schedule: run.schedule(),
            boardSize: board.rows.count + board.market.count, week: nil, host: nil,
            zone: TimeZone(identifier: parity.zone)!, now: Fixtures.instant(Fixtures.week)
        )
    }

    @Test(arguments: parity.pages.indices)
    func eachPagePrintsThePagesWords(index: Int) throws {
        let page = Self.parity.pages[index]
        let input = try Self.input(page)
        let model = try #require(PlayerPages.page(input))
        let name = "\(page.player) on \(page.run)"
        #expect(PlayerPages.underway(input) == page.underway, "\(name)")
        #expect(model.caption == page.words.caption, "\(name)")
        #expect(model.drafters.label == page.words.draftersLabel, "\(name)")
        #expect(model.drafters.figure == page.words.draftersFigure, "\(name)")
        #expect(model.drafters.words == page.words.drafters, "\(name)")
        if let value = page.words.value {
            #expect(model.overReplacement.words == value, "\(name)")
        }
        #expect(model.figure == page.figure, "\(name)")
        #expect(model.hero.club == page.clubName, "\(name)")
        #expect(model.heldTier == page.heldTier, "\(name)")
        let player = try (page.run == "contract" ? RunFixture.contract : RunFixture.standIn).page(id: page.player)
        #expect(PageWords.readStamp(player.capsule?.value1) == page.readStamp, "\(name)")
        let projected = try #require(player.formats.additionalProperties[page.format]).projected
        let figures = ReadFigures.preseason(player.capsule?.value1.pulls ?? [], projection: projected)
        #expect(
            figures.map { Figure(label: $0.label, figure: $0.figure, caption: $0.caption) } == page.pulls,
            "\(name)"
        )
    }

    @Test(arguments: parity.verbs.indices)
    func everyVerbIsWordedAsTheWebWordsIt(index: Int) throws {
        let test = Self.parity.verbs[index]
        let host = Components.Schemas.LeagueHost(value1: .init(rawValue: test.host))
        let verb = try #require(CardVerbs.of(test.verb, host: host))
        let name = "\(test.verb.kind.value1?.rawValue ?? "") on \(test.host)"
        #expect(verb.label == test.label, "\(name)")
        #expect(verb.note == test.note, "\(name)")
        if case .platform = verb.target {
            #expect(test.external, "\(name)")
        } else {
            #expect(!test.external, "\(name)")
        }
    }

    @Test func startHimTurnsToTheLineupOnceHisGameHasKickedOff() throws {
        let start = PlayerVerb(kind: .init(value1: .start), holder: nil, hostUrl: nil, note: nil)
        for test in Self.parity.heldVerbs {
            let week = try WeekFixture.league(test.player, at: Fixtures.clockPart(test.clock))
            let held = CardVerbs.held(start, line: week.line, now: test.clock)
            #expect(held.kind.value1?.rawValue == test.kind, "\(test.clock)")
        }
    }
}

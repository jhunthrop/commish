import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The player page held to the web's (shared/fixtures/parity/player-sheet.json): every page of both
/// fixture runs, where drafters take him and his value (shown before the season only), his range's
/// caption, his club, the card as built, his season block, his tier box, the every-format table, the
/// read's stamp and figures, the held tier and whether the run is under way; what a read not written
/// will be built from; and the league verb's words for every kind on every platform, Start him turning
/// to the lineup once his game has kicked off.
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
        let outcomesCaption: String
        let built: Built
        let season: Season
        let tier: Tier?
        let formats: Formats
    }

    struct Head: Decodable, Equatable {
        let week: Int
        let opponent: String
    }

    struct Built: Decodable {
        let next: Head?
        let tiles: [PlayerSheetParityTests.Tile]
    }

    struct Short: Decodable, Equatable {
        let short: String
        let full: String
    }

    struct Cell: Decodable, Equatable {
        let value: String
        let caption: String
    }

    struct Line: Decodable, Equatable {
        let lead: String
        let sub: String
        let total: String
        let points: Cell
        let cells: [Cell]
    }

    struct Row: Decodable, Equatable {
        let week: Int
        let opponent: String
        let note: String
        let tone: String
        let points: String?
        let cells: [String]?
    }

    struct Ahead: Decodable, Equatable {
        let week: Int
        let opponent: String
        let bye: Bool
        let day: String
    }

    struct Prior: Decodable, Equatable {
        let season: Int
        let sub: String
        let total: String
        let cells: [String]
    }

    struct Season: Decodable {
        let season: Int
        let aside: String
        let heads: [Short]
        let pointsHead: Short
        let line: Line?
        let rows: [Row]
        let ahead: [Ahead]
        let none: String
        let basis: String?
        let prior: [Prior]
    }

    struct Mate: Decodable, Equatable {
        let id: String
        let name: String
        let positionRank: Int
        let team: String
        let projected: String
        let span: String?
    }

    struct Tier: Decodable {
        let tier: Int
        let mates: [Mate]
        let drop: String?
        let basis: String
    }

    struct FormatRow: Decodable, Equatable {
        let label: String
        let rank: String
        let points: String
        let vor: String
        let tier: String
    }

    struct Formats: Decodable {
        let head: String
        let note: String?
        let rows: [FormatRow]
    }

    struct Unwritten: Decodable {
        struct Item: Decodable, Equatable {
            let lead: String
            let text: String
            let figure: String
        }

        let player: String
        let format: String
        let lines: [Item]
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
        let unwritten: [Unwritten]
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
            board: board, week: nil, host: nil,
            zone: TimeZone(identifier: parity.zone)!, now: Fixtures.instant(Fixtures.week)
        )
    }

    @Test(arguments: parity.pages.indices)
    func eachPagePrintsThePagesWords(index: Int) throws {
        let page = Self.parity.pages[index]
        let input = try Self.input(page)
        let model = try #require(PlayerPages.page(input))
        let name = "\(page.player) on \(page.run)"
        let run = page.run == "contract" ? RunFixture.contract : RunFixture.standIn
        let player = try run.page(id: page.player)
        let format = try #require(run.manifest().formats.first { $0.id == page.format })
        let numbers = try #require(player.formats.additionalProperties[page.format])
        let words = try PageWords.line(
            format, numbers: LineNumbers(numbers), sources: RunWords.adpDrafts(run.adpSources(), format: format.id),
            boardSize: input.boardSize,
            season: .init(year: run.manifest().season, underway: page.underway, heldOut: page.heldTier != nil)
        )
        #expect(PlayerPages.underway(input) == page.underway, "\(name)")
        #expect(words.caption == page.words.caption, "\(name)")
        #expect(words.draftersLabel == page.words.draftersLabel, "\(name)")
        #expect(words.draftersFigure == page.words.draftersFigure, "\(name)")
        #expect(words.drafters == page.words.drafters, "\(name)")
        if let value = page.words.value {
            #expect(words.value == value, "\(name)")
        }
        // The facts show before the season only, as the web's page shows them.
        #expect((model.facts == nil) == page.underway, "\(name)")
        if let facts = model.facts {
            #expect(facts.drafters.words == page.words.drafters, "\(name)")
            #expect(facts.outcomes.map(\.caption) ?? page.outcomesCaption == page.outcomesCaption, "\(name)")
        }
        #expect(Formatting.fixed(numbers.projected) == page.figure, "\(name)")
        #expect(model.hero.club == page.clubName, "\(name)")
        #expect(model.heldTier == page.heldTier, "\(name)")
        #expect(PageWords.readStamp(player.capsule?.value1) == page.readStamp, "\(name)")
        let figures = ReadFigures.preseason(player.capsule?.value1.pulls ?? [], projection: numbers.projected)
        #expect(
            figures.map { Figure(label: $0.label, figure: $0.figure, caption: $0.caption) } == page.pulls,
            "\(name)"
        )
        try sections(model, page: page, name: name)
    }

    /// The card as built, the season block, the tier box and the every-format table.
    func sections(_ model: PlayerPageModel, page: Page, name: String) throws {
        #expect(model.card.head.map { Head(week: $0.week, opponent: $0.opponent) } == page.built.next, "\(name)")
        #expect(model.card.tiles.map(PlayerSheetParityTests.tile) == page.built.tiles, "\(name)")
        season(model.season, page: page, name: name)
        try tables(model, page: page, name: name)
    }

    func season(_ season: SeasonView, page: Page, name: String) {
        #expect(season.aside == page.season.aside, "\(name)")
        #expect(season.heads.map { Short(short: $0.short, full: $0.full) } == page.season.heads, "\(name)")
        #expect(
            Short(short: season.pointsHead.short, full: season.pointsHead.full) == page.season.pointsHead,
            "\(name)"
        )
        #expect(season.line.map { line in
            Line(
                lead: line.lead, sub: line.sub, total: line.total,
                points: Cell(value: line.points.value, caption: line.points.caption),
                cells: line.cells.map { Cell(value: $0.value, caption: $0.caption) }
            )
        } == page.season.line, "\(name)")
        #expect(season.rows.map {
            Row(
                week: $0.week,
                opponent: $0.opponent,
                note: $0.note,
                tone: $0.tone.rawValue,
                points: $0.points,
                cells: $0.cells
            )
        } == page.season.rows, "\(name)")
        #expect(season.ahead.map {
            Ahead(week: $0.week, opponent: $0.opponent, bye: $0.bye, day: $0.day)
        } == page.season.ahead, "\(name)")
        #expect(season.none == page.season.none, "\(name)")
        #expect(season.basis == page.season.basis, "\(name)")
        #expect(season.prior.map {
            Prior(season: $0.season, sub: $0.sub, total: $0.total, cells: $0.cells)
        } == page.season.prior, "\(name)")
    }

    func tables(_ model: PlayerPageModel, page: Page, name: String) throws {
        if let tier = page.tier {
            let box = try #require(model.tier, "\(name)")
            #expect(box.tier == tier.tier, "\(name)")
            #expect(box.drop == tier.drop, "\(name)")
            #expect(box.basis == tier.basis, "\(name)")
            #expect(box.mates.map {
                Mate(
                    id: $0.id,
                    name: $0.name,
                    positionRank: $0.positionRank,
                    team: $0.team,
                    projected: $0.projected,
                    span: $0.span
                )
            } == tier.mates, "\(name)")
        }
        if page.formats.rows.count > 1 {
            let table = try #require(model.formats, "\(name)")
            #expect(table.head == page.formats.head, "\(name)")
            #expect(table.note == page.formats.note, "\(name)")
            #expect(table.rows.map {
                FormatRow(label: $0.label, rank: $0.rank, points: $0.points, vor: $0.vor, tier: $0.tier)
            } == page.formats.rows, "\(name)")
        } else {
            #expect(model.formats == nil, "\(name): one format draws no table")
        }
    }

    @Test(arguments: parity.unwritten.indices)
    func aReadNotWrittenSaysWhatItWillBeBuiltFrom(index: Int) throws {
        let test = Self.parity.unwritten[index]
        let run = RunFixture.standIn
        let player = try run.page(id: test.player)
        let format = try #require(run.manifest().formats.first { $0.id == test.format })
        let numbers = try #require(player.formats.additionalProperties[test.format])
        let board = try run.board(format: test.format)
        let listed = try run.designations()?.players.additionalProperties[test.player]
        let held = listed.flatMap { BoardStatus.view($0, zone: .current)?.rank }
        let lines = try PageSections.unwritten(numbers, .init(
            position: player.position.value1?.rawValue ?? "", boardSize: board.rows.count + board.market.count,
            format: format, year: run.manifest().season, held: held
        ))
        #expect(lines.map { Unwritten.Item(lead: $0.lead, text: $0.text, figure: $0.figure) } == test.lines)
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

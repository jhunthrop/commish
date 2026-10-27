import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The Our record port held to the web's record page at 390 (shared/fixtures/parity/record.json): the
/// lead, the summary (the bug's tiles and pairs, the pending week and when it grades, or the headline)
/// with its gaps and honest sentence, the chips, the line before the weeks, every week line with its
/// status words, its order, its cells at every position and figure and its ESPN sentence, the season to
/// date, the phone's basis, and the draft record; for the contract run's own record on Sunday and the
/// Thursday after, and for the two records before week 7 is set and after it is graded.
struct RecordParityTests {
    static let parity: RecordParity = {
        do {
            return try JSONDecoder().decode(RecordParity.self, from: Fixtures.data("fixtures/parity/record.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/record.json does not read: \(error)")
        }
    }()

    static let cases = ["own-sunday", "own", "waiting", "upcoming", "graded", "published"]

    static func fixture(_ file: String) -> RecordFixture {
        file.hasPrefix("shared/fixtures/record/")
            ? .twoRecords(file.replacingOccurrences(of: "shared/fixtures/record/", with: "")
                .replacingOccurrences(of: ".json", with: ""))
            : .own
    }

    static func model(_ name: String) throws -> (RecordParity.Case, RecordModel) {
        let web = try #require(parity.cases[name])
        let model = try RecordModel(
            record: fixture(web.file).record(), schedule: RecordFixture.schedule(), scoring: web.scoring,
            now: #require(APIDecoding.parseDate(web.now))
        )
        return (web, model)
    }

    @Test(arguments: cases)
    func theLeadAndTheSummaryAreTheWebs(name: String) throws {
        let (web, model) = try Self.model(name)
        #expect(model.title == AppWords.Tab.record)
        #expect(model.lead == web.lead)
        #expect(RecordParity.Bug(model.weekly.bug) == web.weekly.bug)
        #expect(model.weekly.head?.title == web.weekly.head?.title)
        #expect(model.weekly.head?.what == web.weekly.head?.what)
    }

    @Test(arguments: cases)
    func theWeeksAreTheWebsWithTheirStatusWords(name: String) throws {
        let (web, model) = try Self.model(name)
        let section = model.weekly
        #expect(section.positions == web.weekly.positions)
        #expect(section.figures == web.weekly.figures)
        #expect(section.sourceHeads == web.weekly.sourceHeads)
        #expect(section.before?.lead == web.weekly.before?.lead)
        #expect(section.before?.text == web.weekly.before?.text)
        #expect(section.rows.map(RecordParity.Row.init) == web.weekly.rows)
        #expect(section.toDate.map(RecordParity.ToDate.init) == web.weekly.toDate)
        #expect(section.basis == web.weekly.basis)
    }

    @Test(arguments: cases)
    func theDraftRecordIsTheWebs(name: String) throws {
        let (web, model) = try Self.model(name)
        let draft = model.draft
        #expect(draft.title == web.draft.head.title)
        #expect(draft.what == web.draft.head.what)
        #expect(draft.waiting == web.draft.waiting)
        guard web.draft.waiting == nil else {
            return
        }
        #expect(draft.span == web.draft.bug?.span)
        #expect(draft.players == web.draft.bug?.players)
        #expect(draft.tiles.map(RecordParity.DraftTile.init) == web.draft.bug?.tiles)
        #expect(draft.honest == web.draft.bug?.honest)
        #expect(draft.figures == web.draft.figures)
        #expect(draft.rows.map(RecordParity.DraftRow.init) == web.draft.rows)
        #expect(draft.all.map(RecordParity.DraftRow.init) == web.draft.all)
        #expect(draft.basis == web.draft.basis)
    }

    @Test(arguments: cases)
    func theRecordNeverClaimsAWeeklyModel(name: String) throws {
        let (_, model) = try Self.model(name)
        let said = [model.lead, model.weekly.basis, model.draft.basis] + model.weekly.rows.map(\.text)
        #expect(!said.contains { $0.localizedCaseInsensitiveContains("model") })
    }
}

/// shared/fixtures/parity/record.json, as the web's readers wrote it.
struct RecordParity: Decodable, Sendable {
    struct Head: Decodable, Sendable {
        let title: String
        let what: String
    }

    struct Pair: Decodable, Equatable, Sendable {
        let ours: String
        let theirs: String
        let name: String
        let leader: String?
        let lead: String?
        let accented: Bool

        init(_ pair: FigurePair) {
            ours = pair.ours
            theirs = pair.theirs
            name = pair.name
            leader = pair.leader?.rawValue
            lead = pair.lead
            accented = pair.accented
        }
    }

    struct Beside: Decodable, Equatable, Sendable {
        let head: String
        let value: String
        let ours: String?
    }

    struct Values: Decodable, Equatable, Sendable {
        let ours: String
        let beside: [Beside]
    }

    struct Tile: Decodable, Equatable, Sendable {
        let label: String
        let pairs: [Pair]?
        let values: Values?

        init(_ tile: RecordTile) {
            label = tile.label
            pairs = tile.pairs?.map(Pair.init)
            values = tile.ours.map { ours in
                Values(ours: ours, beside: tile.beside.map { Beside(head: $0.head, value: $0.value, ours: $0.ours) })
            }
        }
    }

    struct Bug: Decodable, Equatable, Sendable {
        let kind: String
        let standing: String?
        let head: String?
        let tiles: [Tile]?
        let gaps: String
        let honest: String?
        let title: String?
        let when: String?
        let value: String?
        let caption: String?

        init(_ bug: RecordBug) {
            var standing: String?, head: String?, tiles: [Tile]?, honest: String?
            var title: String?, when: String?, value: String?, caption: String?
            switch bug {
            case let .tiles(said, named, drawn, gaps, sentence):
                kind = "tiles"
                (standing, head, tiles, honest) = (said, named, drawn.map(Tile.init), sentence)
                self.gaps = gaps
            case let .pending(named, saidWhen, gaps):
                kind = "pending"
                (title, when) = (named, saidWhen)
                self.gaps = gaps
            case let .headline(figure, words, gaps):
                kind = "headline"
                (value, caption) = (figure, words)
                self.gaps = gaps
            }
            self.standing = standing
            self.head = head
            self.tiles = tiles
            self.honest = honest
            self.title = title
            self.when = when
            self.value = value
            self.caption = caption
        }
    }

    struct Cell: Decodable, Equatable, Sendable {
        let source: String?
        let value: String
        let same: String?

        init(_ cell: RecordCell) {
            source = nil
            value = cell.value
            same = cell.same
        }

        static func == (lhs: Cell, rhs: Cell) -> Bool {
            lhs.value == rhs.value && lhs.same == rhs.same
        }
    }

    struct FigureCells: Decodable, Equatable, Sendable {
        let trails: Bool
        let cells: [Cell]

        init(_ cells: RecordFigureCells) {
            trails = cells.trails
            self.cells = cells.cells.map(Cell.init)
        }
    }

    typealias Cells = [String: [String: FigureCells]]

    static func cells(_ cells: [String: [RecordFigure: RecordFigureCells]]) -> Cells {
        cells.mapValues { figures in
            Dictionary(uniqueKeysWithValues: figures.map { ($0.key.rawValue, FigureCells($0.value)) })
        }
    }

    struct Row: Decodable, Equatable, Sendable {
        let lead: String
        let text: String
        let order: String?
        let caption: String?
        let graded: Bool
        let players: String?
        let cells: Cells?
        let note: String?

        init(_ row: RecordRow) {
            lead = row.lead
            text = row.text
            order = row.order
            caption = row.caption
            graded = row.graded
            players = row.players
            cells = row.cells.map(RecordParity.cells)
            note = row.note
        }
    }

    struct ToDate: Decodable, Equatable, Sendable {
        let lead: String
        let players: String
        let cells: Cells

        init(_ row: RecordToDate) {
            lead = row.lead
            players = row.players
            cells = RecordParity.cells(row.cells)
        }
    }

    struct Before: Decodable, Sendable {
        let lead: String
        let text: String
    }

    struct Weekly: Decodable, Sendable {
        let head: Head?
        let bug: Bug
        let positions: [String]
        let figures: [String]
        let sourceHeads: [String]
        let before: Before?
        let rows: [Row]
        let toDate: ToDate?
        let basis: String
    }

    struct DraftTile: Decodable, Equatable, Sendable {
        let label: String
        let key: String?
        let pair: Pair

        init(_ tile: CommishCore.DraftTile) {
            label = tile.label
            key = tile.key
            pair = Pair(tile.pair)
        }
    }

    struct DraftBug: Decodable, Sendable {
        let span: String
        let players: String
        let tiles: [DraftTile]
        let honest: String?
    }

    struct DraftCells: Decodable, Equatable, Sendable {
        let accented: Bool
        let cells: [String]
    }

    struct DraftRow: Decodable, Equatable, Sendable {
        let position: String
        let players: Int
        let cells: [String: DraftCells]

        init(_ row: CommishCore.DraftRow) {
            position = row.position
            players = row.players
            cells = Dictionary(uniqueKeysWithValues: row.cells.map { figure, cell in
                (figure.rawValue, DraftCells(accented: cell.accented, cells: [cell.ours, cell.adp]))
            })
        }
    }

    struct Draft: Decodable, Sendable {
        let head: Head
        let waiting: String?
        let bug: DraftBug?
        let figures: [String]?
        let rows: [DraftRow]?
        let all: DraftRow?
        let basis: String?
    }

    struct Case: Decodable, Sendable {
        let now: String
        let file: String
        let scoring: String
        let lead: String
        let weekly: Weekly
        let draft: Draft
    }

    let cases: [String: Case]
}

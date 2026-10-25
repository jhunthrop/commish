import CommishAPI
@testable import CommishCore
import Foundation
import RunFixtures
import Testing

/// The Board's words and figures held to the web's: boardWords for every rail, view, league state and
/// cover, a row's figures and the capture's few words (shared/fixtures/parity/board.json); and over the
/// two fixture runs (shared/fixtures/parity/board-run.json), every view's rows in the web's order with
/// their statuses, byes, tints, tiers and cliffs, the phone's basis, the run's stamp, the offline lead and
/// the rest of the season's caption.
struct BoardParityTests {
    struct Parity: Decodable {
        struct Words: Decodable, Equatable {
            let bar: String
            let title: String
            let heading: String
            let verb: String?
        }

        struct WordsCase: Decodable {
            let rail: String
            let position: String?
            let following: Bool
            let rosFromWeek: Int?
            let words: Words
        }

        struct Figure: Decodable {
            let value: Double
            let projected: String
            let overReplacement: String
            let gap: String
        }

        struct Capture: Decodable {
            let readAt: String
            let checkedAt: String?
            let now: String
            let text: String
        }

        let season: Int
        let label: String
        let words: [WordsCase]
        let figures: [Figure]
        let noGap: String
        let zone: String
        let captures: [Capture]
    }

    /// shared/fixtures/parity/board-run.json.
    struct RunParity: Decodable {
        struct Status: Decodable, Equatable {
            let rank: String?
            let mark: String
            let sits: Bool
        }

        struct Tier: Decodable, Equatable {
            let tier: Int
            let ids: [String]
            let name: String
            let count: String
            let cliff: String
        }

        struct View: Decodable {
            let position: String?
            let ids: [String]
            let tiers: [Tier]
            let basis: [String]
            /// The capture's sentence follows the basis.
            let capture: Bool
        }

        struct Run: Decodable {
            let fixture: String
            let runId: String
            let now: String
            let format: String
            let stamp: String
            let offline: String
            let restCaption: String?
            let words: Parity.Words
            let capture: String?
            let statuses: [String: Status]
            let byes: [String: String?]
            let heats: [String: String]
            let views: [View]
        }

        let zone: String
        let runs: [Run]
    }

    static let parity: Parity = decoded("fixtures/parity/board.json")
    static let runParity: RunParity = decoded("fixtures/parity/board-run.json")

    static func decoded<Value: Decodable>(_ path: String) -> Value {
        do {
            return try JSONDecoder().decode(Value.self, from: Fixtures.data(path))
        } catch {
            preconditionFailure("shared/\(path) does not read: \(error)")
        }
    }

    @Test func everyRailsWordsForTheBoardAreTheWebs() {
        let parity = Self.parity
        #expect(parity.words.count > 40)
        for item in parity.words {
            let inSeason = item.rail == "in_season" || item.rail.hasPrefix("playoffs")
            let cover = BoardCover(
                season: parity.season, label: parity.label, position: item.position,
                restOfSeason: item.rosFromWeek != nil
            )
            let words = BoardWords.of(inSeason: inSeason, cover: cover, following: item.following)
            let said = Parity.Words(
                bar: words.bar, title: words.title, heading: words.heading, verb: words.verb?.rawValue
            )
            #expect(
                said == item.words,
                "\(item.rail) \(item.position ?? "All") \(item.following) \(String(describing: item.rosFromWeek))"
            )
        }
    }

    @Test func aRowsFiguresPrintAsTheWebsDo() {
        for figure in Self.parity.figures {
            #expect(BoardFigures.projected(figure.value) == figure.projected, "\(figure.value)")
            #expect(BoardFigures.signed(figure.value) == figure.overReplacement, "\(figure.value)")
            #expect(BoardFigures.gap(figure.value) == figure.gap, "\(figure.value)")
        }
        #expect(BoardFigures.gap(nil) == Self.parity.noGap)
    }

    @Test func theCapturesFewWordsAreTheWebs() throws {
        let zone = try #require(TimeZone(identifier: Self.parity.zone))
        for capture in Self.parity.captures {
            let said = try BoardWords.capture(
                asOf: #require(APIDecoding.parseDate(capture.readAt)),
                checkedAt: capture.checkedAt.flatMap(APIDecoding.parseDate),
                now: #require(APIDecoding.parseDate(capture.now)),
                zone: zone
            )
            #expect(said == capture.text)
        }
    }

    // MARK: The run's board, view by view

    static func fixture(_ run: RunParity.Run) -> RunFixture {
        run.fixture.hasSuffix("standin-run") ? .standIn : .contract
    }

    static func model(_ run: RunParity.Run, position: String?) throws -> BoardModel {
        let zone = try #require(TimeZone(identifier: runParity.zone))
        return try BoardModel(
            read: fixture(run).read(format: run.format),
            position: position.flatMap(BoardPosition.init(rawValue:)),
            inSeason: run.words.verb != PageVerb.mock.rawValue, following: false,
            now: #require(APIDecoding.parseDate(run.now)), zone: zone
        )
    }

    @Test(arguments: [0, 1])
    func theRunsStampHeadingAndRestOfSeasonAreTheWebs(index: Int) throws {
        let run = Self.runParity.runs[index]
        let model = try Self.model(run, position: nil)
        let manifest = try Self.fixture(run).manifest()
        #expect(model.stamp == run.stamp)
        #expect(RunWords.offline(manifest) == run.offline)
        #expect(model.restLine == run.restCaption)
        #expect(Parity.Words(
            bar: model.words.bar, title: model.words.title, heading: model.words.heading,
            verb: model.words.verb?.rawValue
        ) == run.words)
    }

    @Test(arguments: [0, 1])
    func everyViewListsTheWebsRowsTiersAndBasis(index: Int) throws {
        let run = Self.runParity.runs[index]
        #expect(run.views.count > 1)
        for view in run.views {
            let model = try Self.model(run, position: view.position)
            let name = "\(run.runId) \(view.position ?? "All")"
            #expect(model.rows.map(\.id) == view.ids, "\(name)")
            let tiers = model.sections.compactMap { section in
                section.band.map {
                    RunParity.Tier(
                        tier: $0.tier, ids: section.rows.map(\.id), name: $0.name, count: $0.count, cliff: $0.cliff
                    )
                }
            }
            #expect(tiers == view.tiers, "\(name)")
            let capture = view.capture ? [run.capture].compactMap(\.self) : []
            #expect(model.basis == view.basis + capture, "\(name)")
        }
    }

    @Test(arguments: [0, 1])
    func everyRowsTintAndStatusAreTheWebs(index: Int) throws {
        let run = Self.runParity.runs[index]
        let model = try Self.model(run, position: nil)
        #expect(model.rows.count == run.heats.count)
        for row in model.rows {
            #expect(row.heat.name == run.heats[row.id], "\(row.name)")
            #expect(row.bye == run.byes[row.id].flatMap(\.self), "\(row.name)")
            let said = row.status.map { RunParity.Status(rank: $0.rank, mark: $0.mark, sits: $0.sits) }
            #expect(said == run.statuses[row.id], "\(row.name)")
        }
        #expect(model.basis.last == run.capture)
    }
}

extension RunFixture {
    /// The fixture read as the Board's reader keeps it, each file with the ETag the API gives it.
    func read(format: String) throws -> RunBoardRead {
        try RunBoardRead(
            manifest: Kept(value: manifest(), tag: tag("manifest.json")),
            board: Kept(value: board(format: format), tag: tag("boards/\(format).json")),
            sources: Kept(value: adpSources(), tag: tag("adp.json")),
            designations: Kept(value: designations(), tag: tag("designations.json")),
            clubs: Kept(value: clubs(), tag: tag("clubs.json"))
        )
    }
}

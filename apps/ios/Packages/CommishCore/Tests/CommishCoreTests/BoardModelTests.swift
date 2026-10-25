import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The Board's model over the run (the stand-in before the draft, the contract run in season): every
/// number is the run's, a position's view is its tiers with their cliffs then its season-long list, the
/// round tints the Over replacement, the rest of the season says its weeks, and the basis is complete.
struct BoardModelTests {
    static let preDraft = APIDecoding.parseDate("2026-09-01T17:00:00Z")!
    static let inSeason = APIDecoding.parseDate("2026-10-22T17:00:00Z")!

    static func standIn() throws -> RunBoardRead {
        try RunFixture.standIn.read(format: "ppr-12")
    }

    static func model(
        _ read: RunBoardRead, _ position: BoardPosition?, inSeason: Bool = false, following: Bool = false
    ) -> BoardModel {
        BoardModel(
            read: read, position: position, inSeason: inSeason, following: following,
            now: inSeason ? Self.inSeason : preDraft, zone: Fixtures.zone
        )
    }

    static func runRows(_ read: RunBoardRead, at position: BoardPosition) -> [RunBoardRow] {
        read.board.value.rows.filter { $0.position.value1?.rawValue == position.rawValue }
    }

    // MARK: Every number is the run's

    @Test(arguments: [BoardPosition.quarterback, .runningBack, .receiver, .tightEnd])
    func aPositionViewIsItsTiersInTheRunsPlacesThenItsSeasonLongList(position: BoardPosition) throws {
        let read = try Self.standIn()
        let model = Self.model(read, position)
        let run = Self.runRows(read, at: position)
        #expect(Set(model.rows.map(\.id)) == Set(run.map(\.id)), "every player at the position, once")
        let byID = Dictionary(uniqueKeysWithValues: run.map { ($0.id, $0) })
        let banded = model.sections.filter { $0.band != nil }
        #expect(!banded.isEmpty)
        for section in banded {
            let tier = try #require(section.band?.tier)
            #expect(section.rows.allSatisfy { byID[$0.id]?.tier == tier }, "tier \(tier) holds its own")
            for row in section.rows {
                #expect(row.pill == "\(position.label) \(byID[row.id]?.positionRank ?? -1)")
            }
        }
        let places = banded.flatMap(\.rows).map { byID[$0.id]?.positionRank ?? -1 }
        #expect(places == places.sorted(), "in the run's places at the position")
        let held = model.sections.filter { $0.band == nil }
        #expect(held.allSatisfy { $0.head == Words.Board.heldHead })
        #expect(held.flatMap(\.rows).allSatisfy { $0.status?.onList == true && $0.gap == Words.Box.none })
    }

    @Test func aTiersBandSaysItsCountAndItsDropToTheNextTier() throws {
        let model = try Self.model(Self.standIn(), .receiver)
        let first = try #require(model.sections.first?.band)
        #expect(first.name == "Tier 1")
        #expect(first.count == "2 WRs")
        #expect(first.drop == "23.4")
        #expect(first.dropWords == "PPR pts to tier 2")
        let unsaid = model.sections.compactMap(\.band).filter { $0.drop == nil }
        #expect(unsaid.allSatisfy { $0.dropWords == Words.Tier.lastTier })
    }

    @Test func theAllViewIsTheRunsOrderEachSeasonLongPlayerAfterHisPositionsLastAvailable() throws {
        let read = try Self.standIn()
        let rows = Self.model(read, nil).rows
        #expect(rows.count == read.board.value.rows.count)
        #expect(rows.first?.name == "Puka Nacua")
        for (index, row) in rows.enumerated() where row.status?.onList == true {
            let position = row.pill.split(separator: " ").first.map(String.init) ?? ""
            let lastAvailable = rows.lastIndex { $0.pill.hasPrefix("\(position) ") && $0.status?.onList != true }
            #expect(lastAvailable.map { $0 < index } ?? true, "\(row.name)")
        }
    }

    @Test(arguments: [BoardPosition.kicker, .defense])
    func aKickersOrADefensesViewIsTheDraftsOrder(position: BoardPosition) throws {
        let read = try Self.standIn()
        let model = Self.model(read, position)
        let market = read.board.value.market.filter { $0.position.value1?.rawValue == position.rawValue }
        #expect(model.rows.map(\.id) == market.map(\.id))
        #expect(model.rows.map(\.draftOrder) == market.map { String($0.positionRank) })
        #expect(model.columns == .draftOrder)
        #expect(model.rows.allSatisfy { $0.projected == Words.Box.none && $0.sheetPlayer == nil })
        #expect(model.rows.first?.pill == position.label, "his place is the Draft order column's")
        #expect(model.basis.first?.hasPrefix("Kickers and defenses the drafters take") == true)
        #expect(model.sections.allSatisfy { $0.band == nil }, "no tiers")
    }

    // MARK: The chips, the columns and the words

    @Test func theChipsAreTheRunsFormatsAndThePositionsItsBoardCarries() throws {
        let model = try Self.model(Self.standIn(), .receiver)
        #expect(model.formats.map(\.value) == ["ppr-12"])
        #expect(model.formats.map(\.label) == ["PPR"])
        #expect(model.positions.map(\.label) == ["All", "QB", "RB", "WR", "TE", "K", "DST"])
        #expect(model.positions.filter(\.pressed).map(\.value) == [.receiver])
        let contract = try Self.model(RunFixture.contract.read(format: "ppr-12"), nil, inSeason: true)
        #expect(contract.formats.map(\.value) == ["ppr-12", "half-ppr-12", "standard-12"])
        #expect(contract.formats.filter(\.pressed).map(\.label) == ["PPR"])
    }

    @Test func beforeTheSeasonTheBoardComparesDraftersWithOurRankAndOffersTheMock() throws {
        let model = try Self.model(Self.standIn(), .receiver)
        #expect(model.columns == .ranked(gap: true))
        #expect(model.columns.heads == ["Projected", "Over repl", "Gap"])
        #expect(model.words.heading == "2026 Board")
        #expect(model.words.verb == .mock)
        #expect(model.stamp == "Stand-in, updated Sep 1")
        #expect(model.restLine == nil)
    }

    @Test func inSeasonTheBoardIsTheRestOfItWithItsWeeksAndNoGap() throws {
        let read = try RunFixture.contract.read(format: "ppr-12")
        let model = Self.model(read, nil, inSeason: true)
        #expect(model.columns == .ranked(gap: false))
        #expect(model.words.heading == "Rest of 2026")
        #expect(model.words.verb == .follow)
        #expect(model.stamp == "Updated Oct 21")
        #expect(model.restLine == "PPR points for the rest of the 2026 season from week 7, refreshed October 21")
        #expect(model.basis.first == "Our PPR board, the rest of the 2026 season from week 7, by points over "
            + "replacement for 12 teams, refreshed October 21.")
        #expect(!model.basis.contains { $0.hasPrefix("ADP from") }, "the rest of the season names no drafts")
        #expect(Self.model(read, nil, inSeason: true, following: true).words.verb == nil)
    }

    @Test func whileAGameOfItsFirstWeekIsPlayedTheRestOfSeasonSaysTheGamesLeft() throws {
        let read = try RunFixture.contract.read(format: "ppr-12")
        var manifest = read.manifest.value
        manifest.formats[0].rosFromWeekPartial = true
        let partial = RunBoardRead(
            manifest: Kept(value: manifest, tag: nil), board: read.board, sources: read.sources,
            designations: read.designations
        )
        let model = Self.model(partial, nil, inSeason: true)
        #expect(model.restLine == "PPR points for the rest of the 2026 season from week 7's games left, "
            + "refreshed October 21")
        #expect(model.basis.first?.contains("from week 7's games left") == true)
    }

    @Test func theBasisIsCompleteOurBoardTheTiersTheDraftsTheGapThenTheCapture() throws {
        let model = try Self.model(Self.standIn(), .receiver)
        #expect(model.basis == [
            "Our PPR board, by points over replacement for 12 teams.",
            "Tiers are drawn within WR.",
            "ADP from PPR drafts, Sep 5 to Sep 9.",
            Words.BoardBasis.gap,
            "Status as of Oct 13.",
        ])
    }

    // MARK: A row

    @Test func aRowIsTheWebsAt390WithItsRoundsTint() throws {
        let rows = try Self.model(Self.standIn(), .receiver).rows
        let puka = try #require(rows.first)
        #expect(puka.name == "Puka Nacua")
        #expect(puka.pill == "WR 1")
        #expect(puka.club == "LAR")
        #expect(puka.projected == "344.1")
        #expect(puka.overReplacement == "+164.1")
        #expect(puka.heat == .round(1))
        #expect(puka.gap == "+1.8")
        #expect(puka.gapTone == .gain)
        #expect(puka.headshot?.absoluteString.hasPrefix("https://") == true)
        #expect(puka.sheetPlayer == SheetPlayer(
            id: puka.id, slug: "puka-nacua", name: "Puka Nacua", position: "WR", rank: "1", club: "LAR"
        ))
        #expect(rows.contains { $0.heat == .below && $0.overReplacement.hasPrefix("\u{2212}") })
        #expect(Heat.of(vor: 10, round: 5) == .none)
    }

    @Test func everyRankedRowOpensTheSheetOnTheRunsPlayerBySlug() throws {
        let read = try Self.standIn()
        let slugs = Dictionary(uniqueKeysWithValues: read.board.value.rows.map { ($0.id, $0.slug) })
        for row in Self.model(read, nil).rows {
            #expect(row.sheetPlayer?.id == row.id)
            #expect(row.sheetPlayer?.slug == slugs[row.id])
        }
    }
}

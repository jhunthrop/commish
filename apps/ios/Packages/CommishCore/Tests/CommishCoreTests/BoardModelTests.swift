import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Board's model over the API's PPR board (shared/fixtures/inseason/boards-ppr.json): every view's
/// position numbers are the API's own and its order the API's order (plan Review Focus 4), whatever the
/// view leaves out; the chips, the columns, the words for the season and the basis once.
struct BoardModelTests {
    static let board: RoomBoard = {
        do {
            return try Fixtures.board()
        } catch {
            preconditionFailure("shared/fixtures/inseason/boards-ppr.json does not read: \(error)")
        }
    }()

    static let now = Fixtures.instant(Fixtures.week)

    static func model(_ position: BoardPosition?, inSeason: Bool = false, following: Bool = false) -> BoardModel {
        BoardModel(
            board: board, filter: BoardFilter(format: .ppr, position: position), inSeason: inSeason,
            following: following, now: now, zone: Fixtures.zone
        )
    }

    static func api(at position: BoardPosition) -> [BoardPlayer] {
        board.players.filter { BoardPosition($0.position) == position }
    }

    static var byID: [String: BoardPlayer] {
        Dictionary(uniqueKeysWithValues: board.players.map { ($0.id, $0) })
    }

    // MARK: Review Focus 4: position numbers equal the API's order under every filter

    @Test(arguments: [BoardPosition.quarterback, .runningBack, .receiver, .tightEnd])
    func aPositionViewNumbersEachPlayerAsTheAPIDoesInItsOrder(position: BoardPosition) throws {
        let model = Self.model(position)
        let api = Self.api(at: position)
        #expect(Set(model.rows.map(\.id)) == Set(api.map(\.id)), "every player at the position, once")
        #expect(model.rows.count == api.count)
        let available = try #require(model.sections.first).rows
        let ranks = available.map { Self.byID[$0.id]?.positionRank ?? -1 }
        #expect(ranks == ranks.sorted(), "in the API's order at the position")
        for row in available {
            #expect(row.pill == "\(position.label) \(Self.byID[row.id]?.positionRank ?? -1)")
        }
        let held = model.sections.dropFirst().flatMap(\.rows)
        #expect(held.allSatisfy { Self.byID[$0.id]?.status?.seasonLong == true })
        #expect(model.sections.dropFirst().allSatisfy { $0.head == Words.Board.heldHead })
    }

    @Test func aSeasonLongPlayersPillSaysHisListAndHisChipItsStart() throws {
        let model = Self.model(.runningBack)
        let held = try #require(model.sections.last?.rows.first)
        let status = try #require(held.status)
        #expect(status.onList)
        #expect(held.pill == "RB \(status.rank ?? "")")
        #expect(held.gap == Words.Box.none, "his rank is the word, so no gap")
        #expect(status.mark.hasPrefix(status.rank ?? "?"))
    }

    @Test(arguments: [BoardPosition.kicker, .defense])
    func aKickersOrADefensesViewIsTheDraftsOrderAsTheAPISendsIt(position: BoardPosition) {
        let model = Self.model(position)
        #expect(model.rows.map(\.id) == Self.api(at: position).map(\.id))
        #expect(model.rows.map(\.draftOrder) == Self.api(at: position).map { String($0.positionRank) })
        #expect(model.columns == .draftOrder)
        #expect(model.rows.allSatisfy { $0.projected == Words.Box.none })
        #expect(model.rows.allSatisfy { $0.sheetPlayer == nil }, "the site has no page for him")
        #expect(model.rows.first?.pill == position.label, "his place is the Draft order column's")
    }

    @Test func theAllViewIsOurOrderByOverReplacementEachNumberStillTheAPIs() throws {
        let model = Self.model(nil)
        let rows = model.rows
        let ranked = Self.board.players.filter {
            $0.vor != nil && [.quarterback, .runningBack, .receiver, .tightEnd].contains(BoardPosition($0.position))
        }
        #expect(Set(rows.map(\.id)) == Set(ranked.map(\.id)))
        // Our order: the place the API's Gap gives each available player only rises.
        let places = rows.compactMap { row -> Int? in
            guard let player = Self.byID[row.id], player.status?.seasonLong != true else {
                return nil
            }
            return BoardOrder.place(player)
        }
        #expect(places.count > 100)
        #expect(places == places.sorted())
        #expect(rows.first?.name == "Puka Nacua")
        for row in rows {
            let player = try #require(Self.byID[row.id])
            let rank = player.status?.seasonLong == true ? row.status?.rank ?? "" : String(player.positionRank)
            #expect(row.pill.hasSuffix(" \(rank)"))
        }
    }

    @Test func intheAllViewASeasonLongPlayerFollowsTheLastAvailablePlayerAtHisPosition() {
        let rows = Self.model(nil).rows
        for (index, row) in rows.enumerated() where row.status?.onList == true {
            let position = row.pill.split(separator: " ").first.map(String.init) ?? ""
            let lastAvailable = rows.lastIndex { $0.pill.hasPrefix("\(position) ") && $0.status?.onList != true }
            #expect(lastAvailable.map { $0 < index } ?? true, "\(row.name)")
        }
    }

    // MARK: The chips, the columns and the words

    @Test func theChipsAreTheFormatsAndThePositionsTheBoardCarriesEachPressedOnce() {
        let model = Self.model(.receiver)
        #expect(model.formats.map(\.label) == ["PPR", "Half PPR", "Standard"])
        #expect(model.formats.filter(\.pressed).map(\.value) == [.ppr])
        #expect(model.positions.map(\.label) == ["All", "QB", "RB", "WR", "TE", "K", "DST"])
        #expect(model.positions.filter(\.pressed).map(\.value) == [.receiver])
        #expect(Self.model(nil).positions.filter(\.pressed).map(\.label) == ["All"])
    }

    @Test func beforeTheSeasonTheBoardComparesDraftersWithOurRankAndOffersTheMock() {
        let model = Self.model(.receiver)
        #expect(model.columns == .ranked(gap: true))
        #expect(model.columns.heads == ["Projected", "Over repl", "Gap"])
        #expect(model.words.heading == "2026 Board")
        #expect(model.words.bar == "WR Board")
        #expect(model.words.verb == .mock)
        #expect(model.words.verb?.title == "Start a mock draft")
    }

    @Test func inSeasonTheBoardIsTheRestOfItWithNoGapAndTheVerbFollowsTheLeague() {
        let unfollowed = Self.model(.receiver, inSeason: true)
        #expect(unfollowed.columns == .ranked(gap: false))
        #expect(unfollowed.words.heading == "Rest of 2026")
        #expect(unfollowed.words.verb == .follow)
        #expect(Self.model(.receiver, inSeason: true, following: true).words.verb == nil)
    }

    @Test func aRowIsTheWebsAt390() throws {
        let puka = try #require(Self.model(.receiver).rows.first)
        #expect(puka.name == "Puka Nacua")
        #expect(puka.pill == "WR 1")
        #expect(puka.club == "LAR")
        #expect(puka.bye == "Bye 11")
        #expect(puka.projected == "344.1")
        #expect(puka.overReplacement == "+164.0")
        #expect(puka.gap == "+1.8")
        #expect(puka.gapTone == .gain)
        #expect(puka.sheetPlayer == SheetPlayer(
            id: puka.id, slug: "puka-nacua", name: "Puka Nacua", position: "WR", rank: "1", club: "LAR"
        ))
    }

    @Test func theBasisIsTheWebsOurBoardTheGapsDefinitionThenTheCapture() {
        let capture = "Status as of Oct 13, over 36 hours ago."
        #expect(Self.model(nil).basis == [
            "Our PPR board, by points over replacement for 12 teams.", Words.BoardBasis.gap, capture,
        ])
        #expect(Self.model(.receiver, inSeason: true).basis == [
            "Our PPR board, by points over replacement for 12 teams.", capture,
        ], "no Gap column in season, so no Gap sentence")
        #expect(Self.model(.kicker).basis == [BoardBasis.draftOrder, capture])
    }

    @Test func everyRankedRowWithAPageOpensTheSheetOnTheAPIsPlayer() {
        let names = Self.board.players.map(\.name)
        let unshared = PlayerPages.unshared(names)
        for position in [BoardPosition.quarterback, .runningBack, .receiver, .tightEnd] {
            for row in Self.model(position).rows where unshared.contains(PlayerPages.slug(row.name)) {
                #expect(row.sheetPlayer?.id == row.id, "\(row.name)")
                #expect(row.sheetPlayer?.slug == PlayerPages.slug(row.name))
            }
        }
    }

    @Test func aRowCarriesHisFaceAndItsTintBelowReplacement() throws {
        let rows = Self.model(.receiver).rows
        let puka = try #require(rows.first)
        #expect(puka.headshot?.absoluteString == Self.byID[puka.id]?.headshot)
        #expect(!puka.belowReplacement)
        #expect(rows.contains { $0.belowReplacement && $0.overReplacement.hasPrefix("\u{2212}") })
        #expect(Self.model(.defense).rows.allSatisfy { $0.headshot == nil }, "a defense has no face")
    }
}

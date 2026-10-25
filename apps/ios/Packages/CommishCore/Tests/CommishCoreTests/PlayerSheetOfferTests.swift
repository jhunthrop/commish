import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The sheet's verb as the web's shelf pins it (shelf.ts shelfVerb, the screens' offers): the screen's
/// offer, held on a lineup screen once his game has kicked off or is final; the Start screen's "Back to
/// your lineup" with his swap under it, the Matchup's "Open your lineup" on the member's own rows only,
/// and the Waivers claim in the screen's words with its pair and gain, the strip card's own.
@MainActor
struct PlayerSheetOfferTests {
    static func offer(lineup: Bool) -> SheetOffer {
        SheetOffer(label: Words.Shelf.backToLineup, line: "QB, Dart in, Rodgers out", lineup: lineup) {}
    }

    @Test func aLineupScreensVerbGivesWayToHisGameOnceItHasKickedOff() {
        let offer = Self.offer(lineup: true)
        #expect(SheetVerb.of(offer, game: .upcoming) == .act(
            label: "Back to your lineup",
            line: "QB, Dart in, Rodgers out"
        ))
        #expect(SheetVerb.of(offer, game: .kickedOff) == .held(Words.Card.kickedOff))
        #expect(SheetVerb.of(offer, game: .final) == .held(Words.Card.gameFinal))
        #expect(
            SheetVerb.of(Self.offer(lineup: false), game: .final) != .held(Words.Card.gameFinal),
            "Waivers keeps its verb"
        )
        #expect(SheetVerb.of(nil, game: .upcoming) == nil, "no offer, no verb")
    }

    @Test func theHostHoldsTheScreensOfferUntilTheSheetCloses() {
        let host = PlayerSheetHost()
        let player = PlayerSheetViewModelTests.odunze
        host.open(player, offer: Self.offer(lineup: true))
        #expect(host.offer?.label == "Back to your lineup")
        host.parentRefreshed([player])
        #expect(host.offer?.label == "Back to your lineup", "the list reading again keeps it")
        host.close()
        #expect(host.offer == nil)
    }

    @Test func theStartScreensOfferSaysHisSwap() throws {
        let model = try StartModel(
            advice: Fixtures.lineup(Fixtures.week), host: .init(value1: .ffpc), now: Fixtures.instant(Fixtures.week),
            zone: Fixtures.zone
        )
        let swap = try #require(model.swaps.first)
        let row = try #require((model.starters + model.bench).first { $0.row.id == swap.id }?.row)
        #expect(model.swapLine(row) == StartWords.swap(swap))
        let unswapped = (model.starters + model.bench).first { cells in
            !model.swaps.contains { $0.id == cells.row.id || $0.out == LineupBoxes.shortName(cells.row.name) }
        }
        #expect(unswapped.map { model.swapLine($0.row) } == .some(nil), "no swap names him: no line")
    }

    @Test func theMatchupOffersTheLineupOnTheMembersOwnRowsOnly() throws {
        let week = try MatchupParityTests.week(Fixtures.week, box: true)
        let mine = try #require(week.boxes.first { $0.mine })
        let theirs = try #require(week.boxes.first { !$0.mine })
        let own = try #require((mine.starters + mine.bench).compactMap(\.sheetPlayer).first)
        let opponent = try #require((theirs.starters + theirs.bench).compactMap(\.sheetPlayer).first)
        #expect(week.isMine(own))
        #expect(!week.isMine(opponent))
    }

    @Test func theWaiversOfferIsTheStripCardsClaimForThePickup() throws {
        let model = try WaiverModel(
            advice: Fixtures.waivers(Fixtures.league, Fixtures.week), host: Fixtures.sync().host,
            now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        let card = try #require(model.cards.first)
        let row = try #require(model.rows.first { $0.key == card.key })
        let offer = model.sheetOffer(row)
        #expect(offer.label == card.verb)
        #expect(offer.line == "\(card.move), \(card.gains)")
    }
}

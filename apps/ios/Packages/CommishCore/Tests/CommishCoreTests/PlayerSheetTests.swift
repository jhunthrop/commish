@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The player sheet frame every screen presents from a row: its head from the row's own facts, his
/// full page as the site's universal link, the shelf's words while his week is read, and the same
/// player kept when the screen under it reads again (plan Review Focus 3: the sheet holds his id,
/// never the row's place).
@MainActor
struct PlayerSheetTests {
    static let rows = [
        SheetPlayer(id: "p-1", slug: "puka-nacua", name: "Puka Nacua", position: "WR", rank: "4", club: "LAR"),
        SheetPlayer(id: "p-2", slug: "bijan-robinson", name: "Bijan Robinson", position: "RB", rank: "1", club: "ATL"),
        SheetPlayer(id: "p-3", slug: "sam-laporta", name: "Sam LaPorta", position: "TE", rank: nil, club: "DET"),
    ]

    @Test func theHeadIsTheRowsFacts() {
        let model = PlayerSheetModel(player: Self.rows[1])
        #expect(model.name == "Bijan Robinson")
        #expect(model.initials == "BR")
        #expect(model.pill == "RB 1")
        #expect(model.club == "ATL")
        #expect(PlayerSheetModel(player: Self.rows[2]).pill == "TE")
    }

    @Test func theFullPageIsTheSitesPlayerPage() {
        let model = PlayerSheetModel(player: Self.rows[0])
        #expect(model.fullPage.absoluteString == "https://trycommish.app/players/puka-nacua")
        #expect(model.fullPageWords == Words.Shelf.fullPage)
        #expect(model.closeWords == Words.Shelf.close)
    }

    @Test func whileHisWeekIsReadTheBodySaysWhatTheShelfSays() throws {
        let web = try LeagueSwitchTests.shell().sheetLoading
        #expect(PlayerSheetModel(player: Self.rows[0]).loading == web)
        #expect(PlayerSheetWords.unreadBasis(failed: false, weekTile: Words.Card.proj) == web)
    }

    @Test func theSheetPresentsAndDismisses() {
        let host = PlayerSheetHost()
        #expect(host.shown == nil)
        host.open(Self.rows[1])
        #expect(host.shown?.id == "p-2")
        host.close()
        #expect(host.shown == nil)
    }

    @Test func aParentRefreshKeepsThePlayerTheRowNamed() {
        let host = PlayerSheetHost()
        host.open(Self.rows[1])
        // The list reads again: a new order, his row moved and its facts fresh.
        let fresher = SheetPlayer(
            id: "p-2", slug: "bijan-robinson", name: "Bijan Robinson", position: "RB", rank: "2", club: "ATL"
        )
        host.parentRefreshed([Self.rows[2], Self.rows[0], fresher])
        #expect(host.shown == fresher)
        // A refresh that no longer lists him keeps him as he was shown.
        host.parentRefreshed([Self.rows[0]])
        #expect(host.shown == fresher)
        // A refresh with the sheet closed opens nothing.
        host.close()
        host.parentRefreshed(Self.rows)
        #expect(host.shown == nil)
    }
}

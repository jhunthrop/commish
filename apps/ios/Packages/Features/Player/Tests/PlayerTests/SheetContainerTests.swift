import AppKit
import CommishAPI
import CommishCore
@testable import Player
import RunFixtures
import SwiftUI
import Testing

/// The sheet keeps the player it opened on (plan Review Focus 3), as the app hosts it: the sheet's
/// content made once for his id, the list under it reading again (his fresh facts, the rows in a new
/// order) with the sheet open. Drawn in a hosting view so SwiftUI keeps its state and runs its task as
/// the app does: one read of his week, none again, and his card still the one shown.
@MainActor
struct SheetContainerTests {
    static let odunze = SheetPlayer(
        id: "11620", slug: "rome-odunze", name: "Rome Odunze", position: "WR", rank: "25", club: "CHI",
        boardID: "4431299"
    )

    /// Lets the hosting view lay out and run its tasks.
    static func settle(_ view: NSView) async {
        for _ in 0 ..< 40 {
            view.layoutSubtreeIfNeeded()
            try? await Task.sleep(for: .milliseconds(25))
        }
    }

    @Test func refreshingTheParentWhileTheSheetIsOpenReadsNothingAgainAndKeepsHisCard() async throws {
        let weeks = CountingWeeks(clock: PlayerSnapshotTests.week)
        let host = PlayerSheetHost()
        host.open(Self.odunze)
        let made = Made()
        let make = { @MainActor (player: SheetPlayer) -> PlayerSheetViewModel in
            made.ids.append(player.id)
            return PlayerSheetViewModel(
                player: player, run: StubRun(.standIn), pages: StubPages(.standIn), weeks: weeks,
                cache: PlayerSnapshotTests.cache(),
                clock: FixedClock(PlayerSnapshotTests.instant(PlayerSnapshotTests.week)),
                league: PlayerSnapshotTests.league
            )
        }
        let content = { (player: SheetPlayer) in
            PlayerSheetContainer(player: player, offer: nil, close: {}, make: make)
        }
        let hosting = try NSHostingView(rootView: content(#require(host.shown)))
        hosting.frame = NSRect(x: 0, y: 0, width: 402, height: 874)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = hosting
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        await Self.settle(hosting)
        #expect(await weeks.reads == 1, "his week read once as the sheet opens")
        // The list under the sheet reads again: his row's fresh facts, the others around him.
        let fresher = SheetPlayer(
            id: Self.odunze.id, slug: Self.odunze.slug, name: Self.odunze.name, position: "WR", rank: "24", club: "CHI",
            boardID: Self.odunze.boardID
        )
        host.parentRefreshed([
            SheetPlayer(
                id: "7543",
                slug: "travis-etienne-jr",
                name: "Travis Etienne Jr.",
                position: "RB",
                rank: "14",
                club: "NO"
            ),
            fresher,
        ])
        hosting.rootView = try content(#require(host.shown))
        await Self.settle(hosting)
        #expect(host.shown?.id == Self.odunze.id)
        #expect(made.ids == [Self.odunze.id], "his view model made once")
        #expect(await weeks.reads == 1, "nothing read again under the open sheet")
    }
}

/// The sheet's Full page reaches the app's own page: the playerSheet modifier's link rule sits where the
/// sheet's content takes its environment from, so a player's link opened inside the sheet closes it and
/// opens his page in the app, never the browser (the sheet's top calls openURL as the probe does).
@MainActor
struct FullPageTests {
    @Test func aPlayersLinkOpenedInsideTheSheetClosesItOntoHisPage() async {
        let host = PlayerSheetHost()
        host.open(SheetContainerTests.odunze)
        let opened = Made()
        let screen = Color.clear.playerSheet(
            host, openPage: { opened.ids.append($0) }, content: { LinkProbe(url: SiteLinks.player($0.slug)) }
        )
        let hosting = NSHostingView(rootView: screen)
        hosting.frame = NSRect(x: 0, y: 0, width: 402, height: 874)
        let window = NSWindow(contentRect: hosting.frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = hosting
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        await SheetContainerTests.settle(hosting)
        #expect(opened.ids == ["rome-odunze"], "his page opened in the app")
        #expect(host.shown == nil, "the sheet closed onto it")
    }
}

/// Opens a link as the sheet's Full page does, once it appears.
struct LinkProbe: View {
    @Environment(\.openURL) private var openURL
    let url: URL

    var body: some View {
        Color.clear.frame(width: 10, height: 10).onAppear { openURL(url) }
    }
}

/// The players the sheet made a view model for, in order.
@MainActor
final class Made {
    var ids: [String] = []
}

/// The fixture league's weeks, counting the reads.
actor CountingWeeks: PlayerWeekAPI {
    let clock: String
    private(set) var reads = 0

    init(clock: String) {
        self.clock = clock
    }

    func leagueWeek(league _: String, player: String) async throws -> PlayerWeek {
        reads += 1
        return try WeekFixture.league(player, at: clock)
    }

    func publicWeek(player: String) async throws -> PlayerWeek {
        reads += 1
        return try WeekFixture.publicWeek(player, at: clock)
    }
}

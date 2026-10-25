import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Shell
import SwiftUI
import Testing

/// The shell's mock: the top bar over a league in season and over one before its draft (the bar's
/// five under each, as the system tab bar lists them), the switch open with three leagues in three
/// phases, and the player sheet at its two heights, both themes, iPhone 17 Pro and iPhone SE, at 1x,
/// from the shared fixture's leagues at its Saturday clock. With SNAPSHOT_SHOTS set each is also
/// written at its phone's own scale, which is what the persona panel reads.
@MainActor
struct ShellSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let shared = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason").standardized
    static let zone = TimeZone(identifier: "America/Chicago")!
    /// The fixture's week clock: Saturday noon Central.
    static let now = APIDecoding.parseDate("2026-10-17T17:00:00Z")!

    enum Scene: String, CaseIterable, Sendable {
        case barInSeason = "bar-in-season"
        case barPreDraft = "bar-pre-draft"
        case switchOpen = "switch-open"
        case sheetMedium = "sheet-medium"
        case sheetLarge = "sheet-large"
    }

    struct Case: Sendable {
        let scene: Scene
        let scheme: Scheme
        let device: SnapshotDevice
    }

    nonisolated static let cases: [Case] = Scene.allCases.flatMap { scene in
        [Scheme.light, .dark].flatMap { scheme in
            SnapshotDevice.screens.map { Case(scene: scene, scheme: scheme, device: $0) }
        }
    }

    /// The fixture account's FFPC league in season, a Sleeper league before its draft and one in its
    /// playoffs.
    static func leagues() throws -> [FollowedLeague] {
        let data = try Data(contentsOf: shared.appendingPathComponent("leagues-attached.json"))
        let all = try APIDecoding.envelopeData([Components.Schemas.AttachedLeague].self, from: data)
        return all.filter { ["026", "040", "042"].contains(String($0.id.suffix(3))) }.map {
            FollowedLeague(
                id: $0.id, name: $0.name, host: $0.host, phase: $0.phase.value1, draftAt: $0.draftAt,
                waiversOpen: $0.waiversOpen
            )
        }
    }

    static let player = SheetPlayer(
        id: "4983", slug: "puka-nacua", name: "Puka Nacua", position: "WR", rank: "4", club: "LAR"
    )

    @ViewBuilder
    static func view(_ scene: Scene, device: SnapshotDevice) throws -> some View {
        let leagues = try leagues()
        switch scene {
        case .barInSeason, .switchOpen:
            ShellMock(
                model: LeagueSwitchModel(leagues: leagues, selected: leagues[0].id, now: now, zone: zone),
                tabs: PhoneRail.tabs(phase: leagues[0].phase, waiversOpen: true), open: scene == .switchOpen
            )
        case .barPreDraft:
            ShellMock(
                model: LeagueSwitchModel(leagues: leagues, selected: leagues[1].id, now: now, zone: zone),
                tabs: PhoneRail.tabs(phase: leagues[1].phase, waiversOpen: true), open: false
            )
        case .sheetMedium, .sheetLarge:
            SheetMock(player: player, device: device, large: scene == .sheetLarge)
        }
    }

    @Test(arguments: 0 ..< cases.count)
    func shell(index: Int) throws {
        let item = Self.cases[index]
        let name = "shell-\(item.scene.rawValue)-\(item.device.name)-\(item.scheme)"
        let view = try Self.view(item.scene, device: item.device)
        Snapshot.shoot(view, named: name, device: item.device, scheme: item.scheme)
        let result = Snapshot.verify(view, named: name, device: item.device, scheme: item.scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }
}

/// The bar, the room a screen takes under it, and the five as the system tab bar lists them (the app
/// draws the native tab bar; the mock draws its items so the panel reads the bar by phase). Open, the
/// switch's list lies under the bar as on the web's phone.
struct ShellMock: View {
    let model: LeagueSwitchModel
    let tabs: [RailTab]
    let open: Bool

    var body: some View {
        VStack(spacing: 0) {
            TopBar(
                face: model.face, open: open, query: .constant(""), still: true,
                actions: TopBarActions(toggleSwitch: {}, openAccount: {}, search: { _ in })
            )
            ZStack(alignment: .top) {
                Color.clear.frame(height: open ? 360 : 140)
                if open {
                    LeagueSwitchMenu(model: model, choose: { _ in })
                        .padding(.horizontal, Tokens.Space.s3)
                        .padding(.top, Tokens.Space.s1)
                }
            }
            TabStrip(tabs: tabs)
        }
    }
}

/// The five tabs, the first selected, as the system tab bar draws them.
struct TabStrip: View {
    @Environment(\.colorScheme) private var colorScheme
    let tabs: [RailTab]

    var body: some View {
        let theme = Theme(colorScheme)
        HStack(spacing: 0) {
            ForEach(Array(tabs.enumerated()), id: \.element.id) { index, tab in
                VStack(spacing: 3) {
                    Image(systemName: TabSymbols.symbol(tab.key)).font(.system(size: 20))
                    Text(tab.label).font(.system(size: 10, weight: .medium))
                }
                .foregroundStyle(theme.color(index == 0 ? Tokens.Color.accentText : Tokens.Color.ink3))
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 6)
        .frame(height: 50)
        .background(theme.color(Tokens.Color.shell))
        .overlay(alignment: .top) { Rectangle().fill(theme.color(Tokens.Color.shellLine)).frame(height: 1) }
    }
}

/// The sheet over a dimmed screen at one of its two heights: half the phone's screen (medium), or
/// all of it under the status bar (large), its grabber at the top as the system draws it.
struct SheetMock: View {
    @Environment(\.colorScheme) private var colorScheme
    let player: SheetPlayer
    let device: SnapshotDevice
    let large: Bool

    /// The status bar's room above a large sheet: the notch phone's and the home-button phone's.
    private var top: Double {
        device.height > 700 ? 72 : 30
    }

    var body: some View {
        let theme = Theme(colorScheme)
        let height = large ? device.height - top : device.height / 2
        VStack(spacing: 0) {
            Color.black.opacity(colorScheme == .dark ? 0.6 : 0.3)
            VStack(spacing: 0) {
                Capsule().fill(theme.color(Tokens.Color.lineStrong)).frame(width: 36, height: 5).padding(.top, 5)
                PlayerSheetView(model: PlayerSheetModel(player: player), close: {})
            }
            .frame(height: height)
            .background(theme.color(Tokens.Color.bg))
            .clipShape(UnevenRoundedRectangle(topLeadingRadius: 12, topTrailingRadius: 12))
        }
        .frame(height: device.height)
    }
}

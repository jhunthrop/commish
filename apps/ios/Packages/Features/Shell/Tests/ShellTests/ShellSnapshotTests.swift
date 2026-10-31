import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import Shell
import SwiftUI
import Testing

/// The shell's mock: the top bar over a league in season, over one before its draft and over none
/// (the bar's five under each, as the system tab bar lists them), the switch open with three leagues
/// in three phases over the season's bar and over the draft's, the signed-out League tab's sign-in
/// over the public five (no top bar, as Android), and the player sheet at its two heights, both
/// themes, iPhone 17 Pro and iPhone SE, at 1x, from the shared fixture's leagues at its Saturday
/// clock. With SNAPSHOT_SHOTS set each is also written at its phone's own scale, which is what the
/// persona panel reads.
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
        /// B149: a bar with no League tab, the switch open as the way to any league's home.
        case preDraftSwitchOpen = "pre-draft-switch-open"
        /// No league followed: the bar for the site's season.
        case barNoLeague = "bar-no-league"
        /// B155: signed out, the public tabs with the League tab as the sign-in.
        case signedOut = "signed-out"
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
    /// playoffs, each scoring PPR as the fixture API's GET /me says (its stand-ins all read on PPR).
    static func leagues() throws -> [FollowedLeague] {
        let data = try Data(contentsOf: shared.appendingPathComponent("leagues-attached.json"))
        let all = try APIDecoding.envelopeData([Components.Schemas.AttachedLeague].self, from: data)
        return all.filter { ["026", "040", "042"].contains(String($0.id.suffix(3))) }.map {
            FollowedLeague(
                id: $0.id, name: $0.name, host: $0.host, scoring: .ppr, format: .ppr, phase: $0.phase.value1,
                draftAt: $0.draftAt, waiversOpen: $0.waiversOpen
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
                tabs: PhoneRail.bar(league: leagues[0], season: .inSeason), open: scene == .switchOpen
            )
        case .barPreDraft, .preDraftSwitchOpen:
            ShellMock(
                model: LeagueSwitchModel(leagues: leagues, selected: leagues[1].id, now: now, zone: zone),
                tabs: PhoneRail.bar(league: leagues[1], season: .inSeason), open: scene == .preDraftSwitchOpen
            )
        case .barNoLeague:
            ShellMock(
                model: LeagueSwitchModel(leagues: [], selected: nil, now: now, zone: zone),
                tabs: PhoneRail.bar(league: nil, season: .inSeason), open: false
            )
        case .signedOut:
            SignedOutMock(device: device)
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
            TabStrip(tabs: tabs, lit: tabs.first?.key)
        }
    }
}

/// Signed out: the League tab's sign-in filling the screen between the status bar and the five, the
/// web's public bar with the League tab first and selected.
struct SignedOutMock: View {
    let device: SnapshotDevice

    var body: some View {
        VStack(spacing: 0) {
            SignInView(working: false, problem: nil, signIn: {})
                .frame(height: device.height - (device.height > 700 ? 54 + 34 : 20) - 50)
            TabStrip(tabs: PhoneRail.withoutLeague, lit: PhoneRail.withoutLeague.first?.key)
        }
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

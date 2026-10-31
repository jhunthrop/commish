import CommishDesign
import CommishSnapshotSupport
import Foundation
import SwiftUI
import Testing

/// The App Store screenshots: each of the eight the app's own screen over the shared fixtures under its
/// caption, dark theme, at both iPhone sizes App Store Connect takes, written as opaque PNG at the exact
/// pixels. Drawn on the host's SwiftUI with ImageRenderer, as every screen's snapshot mock is, at the
/// phone's own 3x scale. Skipped unless STORE_SHOTS names the folder to write (the store run sets it,
/// with COMMISH_FIXTURES naming the renamed copy of the fixtures): the package tests draw nothing.
@MainActor
struct StoreShotsTests {
    /// The environment variable naming the folder the shots are written to.
    nonisolated static let folderVariable = "STORE_SHOTS"
    nonisolated static let folder = ProcessInfo.processInfo.environment[folderVariable]

    struct Case: Sendable, CustomTestStringConvertible {
        let shot: StoreShot
        let size: StoreDevice

        var testDescription: String {
            size.file(shot)
        }
    }

    nonisolated static let cases = StoreDevice.allCases.flatMap { size in
        StoreShot.allCases.map { Case(shot: $0, size: size) }
    }

    static func screen(_ shot: StoreShot) async throws -> StoreScreen {
        switch shot {
        case .lineup: try await InSeasonScenes.lineup()
        case .waivers: try await InSeasonScenes.waivers()
        case .trades: try await InSeasonScenes.trades()
        case .matchup: try await InSeasonScenes.matchup()
        case .rankings: try await PageScenes.rankings()
        case .board: try await PageScenes.board()
        case .mockRoom: try await PageScenes.mockRoom()
        case .player: try await PageScenes.playerPage()
        }
    }

    @Test(.enabled(if: folder != nil, "STORE_SHOTS names no folder"), arguments: cases)
    func shot(_ item: Case) async throws {
        let folder = try #require(Self.folder)
        let device = item.size.device
        let frame = try await StoreShotFrame(
            caption: item.shot.caption, chrome: StoreFixtures.chrome(item.shot), screen: Self.screen(item.shot),
            size: CGSize(width: device.width, height: device.height)
        )
        let image = try #require(Snapshot.render(frame, device: device, scheme: .dark, scale: device.scale))
        let pixels = item.size.pixels
        #expect(image.width == pixels.width && image.height == pixels.height, "\(image.width) x \(image.height)")
        let file = URL(fileURLWithPath: folder).appendingPathComponent(item.size.file(item.shot))
        #expect(Snapshot.write(image, to: file), "could not write \(file.path)")
    }

    @Test func theSizesAreTheOnesAppStoreConnectTakes() {
        #expect(StoreDevice.medium.pixels == (1206, 2622))
        #expect(StoreDevice.large.pixels == (1320, 2868))
    }
}

import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import LeagueHome
import SwiftUI
import Testing

/// The League home's mock: the fixture league at its Sunday clock (the noon games in their fourth
/// quarter) and at its Saturday clock (every Sunday game to come), both themes, iPhone 15 and iPhone
/// SE, the whole height. These images are what the persona panel reads.
@MainActor
struct LeagueHomeSnapshotTests {
    static let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("__Snapshots__")
    static let shared = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../../../../../../../shared/fixtures/inseason").standardized
    static let league = "6f1d1c52-2626-4a26-9a26-000000000026"
    static let zone = TimeZone(identifier: "America/Chicago")!

    struct Case: Sendable {
        let clock: String
        let scheme: Scheme
        let device: SnapshotDevice
    }

    nonisolated static let cases: [Case] = [
        "2026-10-18T18-56-00Z", "2026-10-17T17-00-00Z",
    ].flatMap { clock in
        [Scheme.light, .dark].flatMap { scheme in
            SnapshotDevice.all.map { Case(clock: clock, scheme: scheme, device: $0) }
        }
    }

    static func model(at clock: String) throws -> LeagueHomeModel {
        let sync = try APIDecoding.envelopeData(
            LeagueSync.self, from: Data(contentsOf: shared.appendingPathComponent("leagues-attached-\(league).json"))
        )
        let board = try APIDecoding.envelopeData(
            Scoreboard.self,
            from: Data(contentsOf: shared.appendingPathComponent("scoreboard-\(league)-\(clock).json"))
        )
        let text = clock.replacingOccurrences(
            of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
        )
        let now = try #require(APIDecoding.parseDate(text))
        return LeagueHomeModel(sync: sync, scoreboard: board, now: now, zone: zone)
    }

    @Test(arguments: 0 ..< cases.count)
    func leagueHome(index: Int) throws {
        let (clock, scheme, device) = (Self.cases[index].clock, Self.cases[index].scheme, Self.cases[index].device)
        let screen = try LeagueHomeScreen(model: Self.model(at: clock), stamp: nil, still: true, openLineup: {})
        let image = try #require(Snapshot.render(screen, device: device, scheme: scheme))
        let name = "league-home-\(clock.prefix(10))-\(device.name)-\(scheme)"
        let result = Snapshot.verify(image, named: name, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func aSavedHomeCarriesItsStamp() throws {
        let screen = try LeagueHomeScreen(
            model: Self.model(at: "2026-10-18T18-56-00Z"), stamp: "\(AppWords.lastRead) Sun 1:52 pm", still: true,
            openLineup: {}
        )
        let image = try #require(Snapshot.render(screen, device: .iPhoneSE, scheme: .light))
        let result = Snapshot.verify(image, named: "league-home-stale-iPhoneSE-light", in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }
}

import CommishAPI
import CommishCore
import CommishDesign
import CommishSnapshotSupport
import Foundation
@testable import LeagueHome
import SwiftUI
import Testing

/// The League home's mock: the fixture league at its Sunday clock (the noon games in their fourth
/// quarter) in its three runs, and its top at the Saturday clock (every Sunday game to come), both
/// themes, iPhone 15 and iPhone SE, at 1x. With SNAPSHOT_SHOTS set the whole screen is also written
/// at each phone's own scale, which is what the persona panel reads.
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

    /// The runs a clock is drawn in: every run on Sunday; Saturday's lineup and moves are Sunday's.
    static func parts(at clock: String) -> [LeagueHomePart] {
        clock == "2026-10-18T18-56-00Z" ? LeagueHomePart.allCases : [.top]
    }

    @Test(arguments: 0 ..< cases.count)
    func leagueHome(index: Int) throws {
        let (clock, scheme, device) = (Self.cases[index].clock, Self.cases[index].scheme, Self.cases[index].device)
        let model = try Self.model(at: clock)
        let name = "league-home-\(clock.prefix(10))-\(device.name)-\(scheme)"
        Snapshot.shoot(
            LeagueHomeScreen(model: model, stamp: nil, still: true, openLineup: {}),
            named: name, device: device, scheme: scheme
        )
        for part in Self.parts(at: clock) {
            let view = LeagueHomePartView(part: part, model: model, stamp: nil, still: true, openLineup: {})
            let result = Snapshot.verify(
                view, named: "\(name)-\(part)", device: device, scheme: scheme, in: Self.folder
            )
            #expect(result.matches, "\(result.message)")
        }
    }

    /// Draft day's entry under the league's head (SeasonPanel.svelte, draft_day): the draft tonight on
    /// the member's clock, the zone once, the Advisor's verb.
    @Test(arguments: [Scheme.light, .dark].flatMap { scheme in SnapshotDevice.all.map { (scheme, $0) } })
    func draftDayCarriesTheAdvisor(scheme: Scheme, device: SnapshotDevice) throws {
        let now = try #require(APIDecoding.parseDate("2026-10-17T17:00:00Z"))
        let entry = try #require(DraftDayEntry(
            phase: .draftDay, draftAt: APIDecoding.parseDate("2026-10-18T00:30:00Z"), now: now, zone: Self.zone
        ))
        let view = try LeagueHomePartView(
            part: .top, model: Self.model(at: "2026-10-17T17-00-00Z"), stamp: nil, still: true, openLineup: {},
            draftDay: entry
        )
        let name = "league-home-draft-day-\(device.name)-\(scheme)"
        Snapshot.shoot(view, named: name, device: device, scheme: scheme)
        let result = Snapshot.verify(view, named: name, device: device, scheme: scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    /// Before the draft the same entry carries the mock draft (SeasonPanel.svelte, pre_draft): the draft
    /// tonight on the member's clock, the zone once, Start a mock draft (Lane 213).
    @Test(arguments: [Scheme.light, .dark].flatMap { scheme in SnapshotDevice.all.map { (scheme, $0) } })
    func beforeTheDraftCarriesTheMock(scheme: Scheme, device: SnapshotDevice) throws {
        let now = try #require(APIDecoding.parseDate("2026-10-17T17:00:00Z"))
        let entry = try #require(DraftDayEntry(
            phase: .preDraft, draftAt: APIDecoding.parseDate("2026-10-18T00:30:00Z"), now: now, zone: Self.zone
        ))
        #expect(entry.opens == .mock)
        #expect(entry.verb == Words.PageVerb.mock)
        let view = try LeagueHomePartView(
            part: .top, model: Self.model(at: "2026-10-17T17-00-00Z"), stamp: nil, still: true, openLineup: {},
            draftDay: entry
        )
        let name = "league-home-pre-draft-\(device.name)-\(scheme)"
        Snapshot.shoot(view, named: name, device: device, scheme: scheme)
        let result = Snapshot.verify(view, named: name, device: device, scheme: scheme, in: Self.folder)
        #expect(result.matches, "\(result.message)")
    }

    @Test func aSavedHomeCarriesItsStamp() throws {
        let view = try LeagueHomePartView(
            part: .top, model: Self.model(at: "2026-10-18T18-56-00Z"), stamp: "\(AppWords.lastRead) Sun 1:52 pm",
            still: true, openLineup: {}
        )
        let result = Snapshot.verify(
            view, named: "league-home-stale-iPhoneSE-light-top", device: .iPhoneSE, scheme: .light, in: Self.folder
        )
        #expect(result.matches, "\(result.message)")
    }

    @Test func everyReferenceIsSmallEnoughToKeep() {
        #expect(Snapshot.oversized(in: Self.folder).isEmpty, "\(Snapshot.oversized(in: Self.folder))")
    }
}

import CommishAPI
import CommishCore
import Foundation
import RunFixtures

/// The fixture league as the store shots read it: the shared fixtures through RunFixture's folder, which
/// the store run points at a copy with the recorded league's team names and handles replaced
/// (shared/store/store-names.json, COMMISH_FIXTURES), the league named "Sunday Standard" on a platform
/// the lineup and the claim are made on, which every screen names with the neutral platform's words
/// (StoreHost, Lane 310).
enum StoreFixtures {
    static let inseason = RunFixture.fixtures.appendingPathComponent("inseason")
    static let zone = TimeZone(identifier: "America/Chicago")!

    /// The fixture league (web/scripts/inseason-fixture/ids.ts).
    static let leagueID = "6f1d1c52-2626-4a26-9a26-000000000026"
    /// The ESPN stand-in whose claim waits for the wire to clear (the Waivers' pending scene).
    static let pendingClaimLeague = "6f1d1c52-2626-4a26-9a26-000000000037"
    /// The fixture's week clock, Saturday noon Central, as its files name it.
    static let saturday = "2026-10-17T17-00-00Z"
    /// Sunday afternoon with the games under way.
    static let sunday = "2026-10-18T18-56-00Z"

    /// The made-up name the store copy gives the fixture league (store-names.json).
    static let leagueName = "Sunday Standard"
    /// The member's team as the store copy names it, and where it stands.
    static let me = TradeMe(name: "Fourth and Long", aside: "1-4, 11th of 12")

    /// The fixture league as the shell holds it, on a platform that takes the app's moves.
    static let league = FollowedLeague(
        id: leagueID, name: leagueName, host: .init(value1: .espn), scoring: .ppr, format: .ppr, phase: .inSeason,
        draftAt: nil, waiversOpen: true
    )

    static var host: Components.Schemas.LeagueHost {
        league.host
    }

    /// A fixture file's clock as its instant: `2026-10-18T18-56-00Z` as 18:56 UTC that day.
    static func instant(_ clock: String) -> Date {
        let text = clock.replacingOccurrences(
            of: #"T(\d\d)-(\d\d)-(\d\d)Z"#, with: "T$1:$2:$3Z", options: .regularExpression
        )
        guard let date = APIDecoding.parseDate(text) else {
            preconditionFailure("\(clock) is not a fixture clock.")
        }
        return date
    }

    /// A fixture answer by its file's name, out of its envelope.
    static func answer<T: Decodable>(_: T.Type, _ file: String) throws -> T {
        try APIDecoding.envelopeData(T.self, from: Data(contentsOf: inseason.appendingPathComponent(file)))
    }

    /// A cache of its own for each view model, so no read is shared between shots.
    static func cache(_ name: String) -> FileCache {
        FileCache(folder: FileManager.default.temporaryDirectory
            .appendingPathComponent("store-shots-\(name)-\(UUID().uuidString)"))
    }

    /// The shell's bars for a shot, at the fixture's Saturday clock.
    static func chrome(_ shot: StoreShot) -> StoreChrome? {
        guard shot.chrome else {
            return nil
        }
        let face = LeagueSwitchModel(leagues: [league], selected: league.id, now: instant(saturday), zone: zone).face
        return StoreChrome(face: face, tabs: PhoneRail.bar(league: league, season: .inSeason), lit: shot.lit)
    }
}

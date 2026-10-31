import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// A platform's words (Lane 310): every real platform says what the screens said before the words were
/// split, and the store graphics' neutral platform places a move in your league.
struct HostWordsTests {
    private let real: [Components.Schemas.LeagueHostKnown] = [.sleeper, .mfl, .ffpc, .yahoo, .espn]

    /// shared/store/store-host.json, the store graphics' neutral platform.
    private let neutral = HostWords(
        name: "your league",
        placed: "in your league",
        stamp: "Read",
        own: "{noun} in your league"
    )

    private let readAt = Date(timeIntervalSince1970: 0)
    private let now = Date(timeIntervalSince1970: 240)

    @Test func aRealPlatformSaysWhatTheScreensAlwaysSaid() {
        for known in real {
            let host = Components.Schemas.LeagueHost(value1: known)
            let name = ValueWords.platform(host)
            let words = HostWords.of(host)
            #expect(words.name == name)
            #expect(WaiverWords.addOn(words) == "Add on \(name)")
            #expect(WaiverWords.openWaivers(words) == "Open \(name) waivers")
            #expect("Open \(words.own("trades"))" == "Open \(name) trades")
            #expect(StartWords.asSet(words) == "as set on \(name)")
            #expect(ScoreBugs.readCell(.init(platform: words.stamp, readAt: readAt), now: now) == "\(name) 4 min ago")
        }
    }

    @Test func theNeutralPlatformPlacesAMoveInYourLeague() {
        #expect(WaiverWords.addOn(neutral) == "Add in your league")
        #expect(WaiverWords.openWaivers(neutral) == "Open waivers in your league")
        #expect("Open \(neutral.own("trades"))" == "Open trades in your league")
        #expect(StartWords.asSet(neutral) == "as set in your league")
        #expect(ScoreBugs.readCell(.init(platform: neutral.stamp, readAt: readAt), now: now) == "Read 4 min ago")
    }
}

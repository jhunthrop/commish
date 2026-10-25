import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The Account's words held to the web's (shared/fixtures/parity/account.json, written by
/// shared/scripts/account-parity.ts from web/src/lib/account/words.ts, league/attached-rows.ts,
/// hosts/platform-rows.ts and hosts/device-words.ts over the same fixture answers).
struct AccountParityTests {
    struct Parity: Decodable {
        struct Who: Decodable {
            let name: String
            let line: String
        }

        struct Plan: Decodable {
            let title: String
            let line: String
        }

        struct Free: Decodable {
            let now: String
            let flag: Bool?
            let free: Bool
        }

        struct League: Decodable {
            let id: String
            let name: String
            let team: String
            let record: String
            let place: String
            let season: String
            let read: String
        }

        struct Count: Decodable {
            let count: Int
            let words: String
            let devices: String
        }

        struct Read: Decodable {
            let readAt: String?
            let words: String
        }

        struct Device: Decodable {
            let id: String
            let line: String
        }

        let now: String
        let zone: String
        let who: Who
        let plan: Plan
        let freeSeason: [Free]
        let leagues: [League]
        let counts: [Count]
        let reads: [Read]
        let devices: [Device]
    }

    static func parity() throws -> Parity {
        try JSONDecoder().decode(Parity.self, from: Fixtures.data("fixtures/parity/account.json"))
    }

    /// The fixture's GET /me, GET /leagues/attached and GET /devices.
    struct Answers {
        let me: AccountAnswer
        let attached: [AttachedLeague]
        let devices: [PairedDeviceRow]
    }

    static func answers() throws -> Answers {
        let inseason = "fixtures/inseason/"
        return try Answers(
            me: APIDecoding.envelopeData(AccountAnswer.self, from: Fixtures.data(inseason + "me.json")),
            attached: APIDecoding.envelopeData(
                [AttachedLeague].self, from: Fixtures.data(inseason + "leagues-attached.json")
            ),
            devices: APIDecoding.envelopeData([PairedDeviceRow].self, from: Fixtures.data(inseason + "devices.json"))
        )
    }

    @Test func whoAndThePlanSayWhatTheWebSays() throws {
        let parity = try Self.parity()
        let me = try Self.answers().me
        #expect(AccountWords.displayName(me) == parity.who.name)
        #expect(AccountWords.whoLine(me) == parity.who.line)
        let now = try #require(APIDecoding.parseDate(parity.now))
        let plan = try #require(PlanCard.of(me, now: now, flag: nil))
        #expect(plan.title == parity.plan.title)
        #expect(plan.line == parity.plan.line)
        for free in parity.freeSeason {
            let instant = try #require(APIDecoding.parseDate(free.now))
            #expect(
                PlanCard.freeSeason(at: instant, flag: free.flag) == free.free,
                "\(free.now) \(String(describing: free.flag))"
            )
        }
    }

    @Test func everyLeaguesRowIsTheWebsRow() throws {
        let parity = try Self.parity()
        let attached = try Self.answers().attached
        let now = try #require(APIDecoding.parseDate(parity.now))
        let zone = try #require(TimeZone(identifier: parity.zone))
        #expect(attached.count == parity.leagues.count)
        for (league, expected) in zip(attached, parity.leagues) {
            let row = AccountWords.leagueRow(league, now: now, zone: zone, detached: false)
            #expect(row.id == expected.id)
            #expect(row.name == expected.name)
            #expect(row.team == expected.team)
            #expect(row.record == expected.record)
            #expect(row.place == expected.place)
            #expect(row.season == expected.season, "\(expected.id)")
            #expect(row.read == expected.read)
        }
    }

    @Test func theCountsTheReadsAndTheDevicesSayWhatTheWebSays() throws {
        let parity = try Self.parity()
        let now = try #require(APIDecoding.parseDate(parity.now))
        for count in parity.counts {
            #expect(AccountWords.attachedCount(count.count) == count.words)
            #expect(AccountWords.deviceCount(count.count) == count.devices)
        }
        for read in parity.reads {
            #expect(AccountWords.readWords(read.readAt.flatMap(APIDecoding.parseDate), now: now) == read.words)
        }
        let devices = try Self.answers().devices
        #expect(devices.map(AccountWords.deviceLine) == parity.devices.map(\.line))
    }
}

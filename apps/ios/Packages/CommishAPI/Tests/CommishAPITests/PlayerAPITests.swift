import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import RunFixtures
import Testing

/// The player sheet's and page's reads through the generated client: the run's page routes (Lane
/// 188's /run/players/{id}, /run/held, /run/held/{id}, /run/index and /run/schedule) with their ETags
/// and 304s, and his week in the league and with none, each over the fixtures as the API answers them.
struct PlayerAPITests {
    private static let base = URL(string: "http://localhost:8080")!
    private static let week = "2026-10-17T17-00-00Z"
    private static let sunday = "2026-10-18T18-56-00Z"

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport,
            middlewares: [ETagMiddleware()]
        ))
    }

    /// A fixture answer as the API sends it: the fixture API's envelope carries no request id, which
    /// the API's always does, so its data is put back in the API's envelope.
    private static func inseason(_ name: String) throws -> Data {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../../../../../shared/fixtures/inseason/\(name)").standardized
        let answer = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        return try JSONSerialization.data(withJSONObject: [
            "ok": true, "data": answer?["data"] ?? NSNull(), "error": NSNull(), "request_id": "fixture",
        ])
    }

    @Test func aPageReadsWithHisReadAndHisCapsuleAndItsETag() async throws {
        let fixture = RunFixture.standIn
        let tag = try fixture.tag("players/4431299.json")
        let transport = try TaggedTransport(status: .ok, tag: tag, body: fixture.pageAnswer(id: "4431299"))
        guard case let .fresh(answer, sent) = try await Self.client(transport).page(id: "4431299", tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        let page = answer.player
        #expect(answer.runId == "2026-10-12T00-standin")
        #expect(sent == tag)
        #expect(page.name == "Rome Odunze")
        #expect(page.weekRead?.value1.week == 6)
        #expect(page.weekRead?.value1.body?.hasPrefix("Rome Odunze is questionable") == true)
        #expect(page.capsule?.value1.body.isEmpty == false)
        #expect(page.formats.additionalProperties["ppr-12"]?.floor == 119.87)
        #expect(await transport.requests.map(\.path) == ["/run/players/4431299"])
    }

    @Test func aKeptPagesETagIsNamedAndA304KeepsTheCopy() async throws {
        let tag = #"W/"2026-10-12T00-standin/players/4431299.json""#
        let transport = TaggedTransport(status: .notModified, tag: tag, body: Data())
        guard case let .unchanged(kept) = try await Self.client(transport).page(id: "4431299", tag: tag) else {
            Issue.record("a 304 is the kept copy")
            return
        }
        #expect(kept == tag)
        #expect(await transport.requests.first?.ifNoneMatch == tag)
    }

    @Test func aHeldPageIsRefusedInTheAPIsWords() async throws {
        let refused = LineupAPITests.problem(
            "not_found",
            "The run held this page: /run/held says whether a copy stands in."
        )
        await #expect(throws: APIError.envelope(
            code: "not_found", message: "The run held this page: /run/held says whether a copy stands in."
        )) {
            _ = try await Self.client(TaggedTransport(status: .notFound, tag: nil, body: refused))
                .page(id: "4239996", tag: nil)
        }
    }

    @Test func theHeldPagesReadNoneOrEachWithItsCopy() async throws {
        let none = LineupAPITests.envelope(#"{"run_id":"r","held":null}"#)
        guard case let .fresh(nothing, _) = try await Self.client(TaggedTransport(status: .ok, tag: nil, body: none))
            .held(tag: nil)
        else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(nothing == nil, "a run that held no page")
        let some = LineupAPITests.envelope(
            #"{"run_id":"r","held":{"pages":[{"id":"4239996","#
                + #""copy":{"runId":"2026-10-20T05","runAt":"2026-10-20T05:00:00.000Z"}},"#
                + #"{"id":"4689114","copy":null}]}}"#
        )
        guard case let .fresh(pages, _) = try await Self.client(TaggedTransport(status: .ok, tag: nil, body: some))
            .held(tag: nil)
        else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(pages?.map(\.id) == ["4239996", "4689114"])
        #expect(pages?.first?.copy?.value1.runId == "2026-10-20T05")
        #expect(pages?.last?.copy == nil, "no copy: his page is the board's figures alone")
    }

    @Test func aHeldPagesCopyReadsAsAPage() async throws {
        let fixture = RunFixture.standIn
        let transport = try TaggedTransport(status: .ok, tag: "W/\"c\"", body: fixture.pageAnswer(id: "4239996"))
        guard case let .fresh(copy, _) = try await Self.client(transport).heldCopy(id: "4239996", tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(copy.name == "Travis Etienne Jr.")
        #expect(await transport.requests.map(\.path) == ["/run/held/4239996"])
    }

    @Test func theIndexAndTheScheduleRead() async throws {
        let fixture = RunFixture.contract
        let index = LineupAPITests.envelope(
            #"{"run_id":"2026-10-21T12-ros","pages":[{"id":"4429795","slug":"jahmyr-gibbs","#
                + #""name":"Jahmyr Gibbs","team":"DET","position":"RB","#
                + #""headshot":"https://a.espncdn.com/i/headshots/nfl/players/full/4429795.png","#
                + #""season":{"games":5,"pointsPerGame":30.7}}],"market":[]}"#
        )
        guard case let .fresh(pages, _) = try await Self.client(TaggedTransport(status: .ok, tag: nil, body: index))
            .index(tag: nil)
        else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(pages.map(\.slug) == ["jahmyr-gibbs"])
        let transport = try TaggedTransport(status: .ok, tag: nil, body: fixture.scheduleAnswer())
        guard case let .fresh(schedule, _) = try await Self.client(transport).schedule(tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(schedule.slates.count == 32)
        #expect(await transport.requests.map(\.path) == ["/run/schedule"])
    }

    @Test func hisWeekInTheLeagueCarriesHisVerbAndHisGamesState() async throws {
        let body = try Self.inseason("player-\(WeekFixture.league)-4431299-\(Self.sunday).json")
        let transport = TaggedTransport(status: .ok, tag: nil, body: body)
        let week = try await Self.client(transport).leagueWeek(league: WeekFixture.league, player: "4431299")
        #expect(week.week == 6)
        #expect(week.line.gameState?.value1.state.value1 == .kickedOff)
        #expect(week.line.gameState?.value1.word == "Kicked off")
        #expect(week.verb?.value1.kind.value1 == .lineup)
        #expect(await transport.requests.map(\.path) == ["/leagues/attached/\(WeekFixture.league)/players/4431299"])
    }

    @Test func hisWeekWithNoLeagueIsInPPRWithNoVerb() async throws {
        let body = try Self.inseason("player-4431299-\(Self.week).json")
        let transport = TaggedTransport(status: .ok, tag: nil, body: body)
        let week = try await Self.client(transport).publicWeek(player: "4431299")
        #expect(week.verb == nil)
        #expect(week.projectionScoring.format.value1 == .ppr)
        #expect(await transport.requests.map(\.path) == ["/players/4431299/week"])
    }

    @Test func aPlayerTheBoardDoesNotPlaceIsRefused() async throws {
        let refused = LineupAPITests.problem("not_found", "Nothing here by that id")
        await #expect(throws: APIError.envelope(code: "not_found", message: "Nothing here by that id")) {
            _ = try await Self.client(TaggedTransport(status: .notFound, tag: nil, body: refused))
                .publicWeek(player: "0000000")
        }
    }
}

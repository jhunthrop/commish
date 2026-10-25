import CommishAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import RunFixtures
import Testing

/// The Rankings' and Our record's reads through the generated client (Lane 194): the order with its
/// query as the web's Players page asks it, the kickers' and defenses' week, and the record and the
/// schedule with their ETags, a kept ETag sent back as the API gave it and a 304 the kept copy.
struct RankingsAPITests {
    private static let base = URL(string: "http://localhost:8080")!

    private static func client(_ transport: some ClientTransport) -> APIClient {
        APIClient(client: Client(
            serverURL: base, configuration: Configuration(dateTranscoder: APIDateTranscoder()), transport: transport,
            middlewares: [ETagMiddleware()]
        ))
    }

    /// A fixture answer as the API sends it, its request id with it.
    private static func fixture(_ path: String) throws -> Data {
        try LineupAPITests.answered(path)
    }

    @Test func aQueryAsksAsThePlayersPageAsks() {
        #expect(OrderQuery(position: nil, search: nil, limit: 100).route == "/order?limit=100&byes=last")
        #expect(
            OrderQuery(position: .wr, search: " wa ", limit: 100).route == "/order?limit=100&position=WR&q=wa&byes=last"
        )
        #expect(OrderQuery(position: nil, search: "w", limit: 100).search == nil, "one letter is no search")
    }

    @Test func theOrderReadsWithItsQueryAndItsRowsInTheAPIsPlaces() async throws {
        let transport = try TaggedTransport(
            status: .ok, tag: nil, body: Self.fixture("order-q-wa-\(RankingsFixture.week).json")
        )
        let advice = try await Self.client(transport).order(OrderQuery(position: nil, search: "wa", limit: 100))
        #expect(advice.total == 12)
        #expect(advice.rows.map(\.rank).prefix(3) == [7, 9, 15])
        let path = await transport.requests.first?.path ?? ""
        #expect(path.hasPrefix("/order?"))
        #expect(path.contains("q=wa") && path.contains("limit=100") && path.contains("byes=last"))
    }

    @Test func theKickersWeekReadsInThePublishedProjectionsOrder() async throws {
        let transport = try TaggedTransport(
            status: .ok, tag: nil, body: Self.fixture("order-week-K-\(RankingsFixture.week).json")
        )
        let advice = try await Self.client(transport).weekOrder(position: .k)
        #expect(advice.position.value1 == .k)
        #expect(advice.rows.isEmpty == false)
        #expect(await transport.requests.first?.path == "/order/week?position=K")
    }

    @Test func theRecordReadsWithItsETagAndA304KeepsTheCopy() async throws {
        let fixture = RecordFixture.twoRecords("graded")
        let fresh = try TaggedTransport(status: .ok, tag: fixture.tag, body: fixture.answer())
        guard case let .fresh(record, sent) = try await Self.client(fresh).record(tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(sent == fixture.tag)
        #expect(record.weekly?.fromWeek == 7)
        #expect(record.draft?.throughWeek == 5)
        let kept = TaggedTransport(status: .notModified, tag: fixture.tag, body: Data())
        guard case let .unchanged(tag) = try await Self.client(kept).record(tag: fixture.tag) else {
            Issue.record("a 304 is the kept copy")
            return
        }
        #expect(tag == fixture.tag)
        #expect(await kept.requests.first?.ifNoneMatch == fixture.tag)
    }

    @Test func theScheduleReadsWithItsETag() async throws {
        let transport = try TaggedTransport(
            status: .ok, tag: RecordFixture.scheduleTag, body: RecordFixture.scheduleAnswer()
        )
        guard case let .fresh(schedule, _) = try await Self.client(transport).recordSchedule(tag: nil) else {
            Issue.record("a first read is fresh")
            return
        }
        #expect(schedule.slates.count == 32)
        #expect(await transport.requests.map(\.path) == ["/run/schedule"])
    }

    @Test func theContractRunsOwnRecordReadsWithoutItsTwoRecords() throws {
        let record = try RecordFixture.own.record()
        #expect(record.weekly == nil)
        #expect(record.draft == nil)
        #expect(record.weeks.count == 18)
    }
}

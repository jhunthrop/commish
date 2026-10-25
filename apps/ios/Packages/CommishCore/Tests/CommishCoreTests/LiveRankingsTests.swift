import CommishAPI
@testable import CommishCore
import Foundation
import Testing

/// The live check, run by hand against a dev API serving the published run (LIVE_API_URL, as
/// http://localhost:18194): the record and its schedule read once through the app's client and drawn,
/// then read again naming the kept ETags, both a 304; and the order and the kickers' week where the
/// database under the API holds them. Skipped without the URL.
@MainActor
struct LiveRankingsTests {
    nonisolated static let api = ProcessInfo.processInfo.environment["LIVE_API_URL"].flatMap(URL.init(string:))

    @Test(.enabled(if: api != nil))
    func theLiveRecordReadsDrawsAndAnswers304sToItsETags() async throws {
        let client = try APIClient(baseURL: #require(Self.api), tokens: LiveRunTests.NoToken())
        guard case let .fresh(record, recordTag) = try await client.record(tag: nil),
              case let .fresh(schedule, scheduleTag) = try await client.schedule(tag: nil)
        else {
            Issue.record("a first read is fresh")
            return
        }
        let model = RecordModel(
            record: record, schedule: schedule, scoring: RecordViewModel.scoring(record.format), now: Date()
        )
        print("record \(record.format), weekly \(record.weekly?.fromWeek.description ?? "none")")
        print("lead: \(model.lead)")
        print("bug: \(model.weekly.bug)")
        for row in model.weekly.rows {
            print("  \(row.lead) | \(row.text) | \(row.order ?? "-")")
        }
        print("draft: \(model.draft.span ?? model.draft.waiting ?? "-")")
        let again = try await client.record(tag: recordTag)
        let scheduleAgain = try await client.schedule(tag: scheduleTag)
        guard case .unchanged = again, case .unchanged = scheduleAgain else {
            Issue.record("a read naming the kept ETag is a 304")
            return
        }
        print("second read: 2 of 2 304s")
    }

    @Test(.enabled(if: api != nil))
    func theLiveOrderReadsWhereTheDatabaseHoldsIt() async throws {
        let client = try APIClient(baseURL: #require(Self.api), tokens: LiveRunTests.NoToken())
        do {
            let advice = try await client.order(OrderQuery(position: nil, search: nil, limit: 100))
            let model = RankingsModel(advice: advice, chip: nil, query: "", inSeason: true, zone: .current, now: Date())
            print("order: week \(advice.week), \(advice.total) players, first \(model.rows.first?.player.name ?? "-")")
        } catch {
            print("order not read on this database: \(error)")
        }
        do {
            let week = try await client.weekOrder(position: .k)
            print("kickers: week \(week.week), \(week.rows.count) rows")
        } catch {
            print("kickers not read on this database: \(error)")
        }
    }
}

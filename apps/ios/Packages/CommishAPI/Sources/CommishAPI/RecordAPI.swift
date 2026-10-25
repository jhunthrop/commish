import Foundation
import OpenAPIRuntime

public typealias RunRecord = Components.Schemas.RunRecord
public typealias RunRecordWeek = Components.Schemas.RunRecordWeek
public typealias RunRecordLine = Components.Schemas.RunRecordLine
public typealias RunWeeklyRecord = Components.Schemas.RunWeeklyRecord
public typealias RunDraftRecord = Components.Schemas.RunDraftRecord
public typealias RunDraftLine = Components.Schemas.RunDraftLine

/// The run's record and the schedule its weeks are read by (web/src/lib/server/pages/record.ts): the
/// record as the nightly wrote it, and every club's games with their kickoffs and states, by which a
/// set week is not played yet, under way or played at the screen's clock. Each read names the ETag the
/// app kept, and a 304 says the kept copy stands. The schedule's read is RunPagesAPI's own (Lane 192),
/// one APIClient method for both. The seam the view model's tests replace with a stub.
public protocol RecordAPI: Sendable {
    /// GET /run/record: the record, with its run's id.
    func record(tag: String?) async throws -> RunRead<RunRecord>
    /// GET /run/schedule: the run's schedule.
    func schedule(tag: String?) async throws -> RunRead<RunSchedule>
}

extension APIClient: RecordAPI {
    public func record(tag: String?) async throws -> RunRead<RunRecord> {
        let input = Operations.RunRecord.Input(headers: .init(ifNoneMatch: tag))
        switch try await Self.unwrapped({ try await client.runRecord(input) }) {
        case let .ok(answer):
            return try .fresh(Self.payload(answer.body.json.value2.data).record, tag: answer.headers.eTag)
        case let .notModified(answer):
            return .unchanged(tag: answer.headers.eTag ?? tag)
        case let .serviceUnavailable(answer):
            throw try Self.problem(answer.body.json)
        case let .undocumented(status, _):
            throw APIError.status(status)
        }
    }
}

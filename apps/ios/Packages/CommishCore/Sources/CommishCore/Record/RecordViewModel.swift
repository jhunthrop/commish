import CommishAPI
import CommishDesign
import Foundation
import Observation

/// The record and the schedule its weeks are read by, as the phone keeps them: each with the ETag the
/// API gave it, sent back on the next read.
public struct RecordRead: Codable, Sendable, Equatable {
    public let record: Kept<RunRecord>
    public let schedule: Kept<RunRecordSchedule>
}

/// The Our record screen's view model (the League home's pattern): the record's routes, the cache and
/// the clock injected; the saved read at once, dated, then the record and the schedule read again
/// naming the ETags kept, so an unchanged run costs two 304s and refreshes only the stamp. A failed
/// read keeps the record shown, stale with its stamp. The chips (the figure a phone shows, the
/// position) are held here. The view decides nothing.
@MainActor
@Observable
public final class RecordViewModel {
    public enum State: Equatable, Sendable {
        case loading
        case loaded(RecordModel, stamp: Date, stale: Bool)
        case failed(String)
    }

    /// The cache key of the read.
    public static let route = "/run/record"

    public private(set) var state: State = .loading
    /// The figure the weeks' table shows (a phone draws one at a time) and the position it is for.
    public private(set) var figure: RecordFigure = .agreement
    public private(set) var position = Words.Records.all
    /// The figure the draft record's table shows.
    public private(set) var draftFigure: RecordFigure = .agreement

    private let api: any RecordAPI
    private let cache: any AnswerCache
    private let clock: any Clock
    private let zone: TimeZone
    private let onSignedOut: @MainActor () -> Void
    private var shown: (read: RecordRead, stamp: Date)?

    public init(
        api: any RecordAPI, cache: any AnswerCache, clock: any Clock, zone: TimeZone = .current,
        onSignedOut: @escaping @MainActor () -> Void = {}
    ) {
        self.api = api
        self.cache = cache
        self.clock = clock
        self.zone = zone
        self.onSignedOut = onSignedOut
    }

    /// "Last read Sat 12:00 pm" while the record shown is a saved one.
    public var stampWords: String? {
        guard case let .loaded(_, stamp, true) = state else {
            return nil
        }
        return AppWords.lastRead(stamp, zone: zone)
    }

    /// The saved read at once when nothing is shown, then the record and the schedule naming their kept
    /// ETags; a failed read keeps what is shown, stale; a refused token signs out.
    public func load() async {
        let saved = await cache.read(RecordRead.self, route: Self.route)
        if shown == nil, let saved {
            show(saved.value, stamp: saved.stamp, stale: true)
        }
        let kept = shown?.read ?? saved?.value
        do {
            async let record = api.record(tag: kept?.record.tag)
            async let schedule = api.recordSchedule(tag: kept?.schedule.tag)
            let fresh = try await RecordRead(
                record: RunBoardReader.resolve(record, kept: kept?.record),
                schedule: RunBoardReader.resolve(schedule, kept: kept?.schedule)
            )
            let stamp = clock.now
            await cache.write(fresh, route: Self.route, stamp: stamp)
            show(fresh, stamp: stamp, stale: false)
        } catch where APIError.signsOut(error) {
            state = .failed(AppWords.Failure.signedOut)
            onSignedOut()
        } catch {
            if let shown {
                show(shown.read, stamp: shown.stamp, stale: true)
            } else {
                state = .failed(LeagueHomeViewModel.sentence(for: error))
            }
        }
    }

    /// A figure chip over the weeks' table.
    public func choose(figure next: RecordFigure) {
        figure = next
    }

    /// A position chip over the weeks' table.
    public func choose(position next: String) {
        position = next
    }

    /// A figure chip over the draft record's table.
    public func choose(draftFigure next: RecordFigure) {
        draftFigure = next
    }

    /// The scoring a run's format is graded in, as the manifest labels it ("ppr-12" is "PPR").
    static func scoring(_ format: String) -> String {
        if format.hasPrefix("half") {
            return Words.BoardFormat.half
        }
        return format.hasPrefix("standard") ? Words.BoardFormat.std : Words.BoardFormat.ppr
    }

    private func show(_ read: RecordRead, stamp: Date, stale: Bool) {
        shown = (read, stamp)
        state = .loaded(
            RecordModel(
                record: read.record.value, schedule: read.schedule.value,
                scoring: Self.scoring(read.record.value.format),
                now: clock.now
            ),
            stamp: stamp, stale: stale
        )
    }
}

import CommishAPI
import Foundation

/// A week read written before his designation changed (web/src/lib/player/status-held.ts, Lane 162):
/// shown under the run's words for it, the status caption over the kept read, never in place of it
/// (Lane 274), judged against the injury capture read beside the run at the screen's clock. A read an
/// older run nulled keeps its caption alone.
public enum StatusHeld {
    /// The zone the read's captions are said in, as the run says them (caption.py CENTRAL).
    static let captionZone = TimeZone(identifier: "America/Chicago")!
    /// The writer's hourly passes, Eastern hours (caption.py HOURLY_PASS_HOURS_ET): midnight, 2 am, then
    /// 6 am through 11 pm.
    static let passHours: Set<Int> = [0, 2, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
    static let passZone = TimeZone(identifier: "America/New_York")!
    static let hour: TimeInterval = 3600
    /// A day of hours and one more: every day holds a pass, so the search ends within it.
    static let hoursSearched = 48

    /// STATUS_HELD_WORDS.changed: the run's caption for a read his status moved past.
    static func changed(due: String) -> String {
        "His status changed since this read was written. A new read is due by \(due)."
    }

    /// nextHourlyPass: the first hourly pass strictly after `after`, on the hour.
    static func nextHourlyPass(after: Date) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = passZone
        let first = (after.timeIntervalSince1970 / hour).rounded(.down) * hour + hour
        for step in 0 ..< hoursSearched {
            let pass = Date(timeIntervalSince1970: first + Double(step) * hour)
            if passHours.contains(calendar.component(.hour, from: pass)) {
                return pass
            }
        }
        preconditionFailure("Every day holds an hourly pass.")
    }

    /// statusChangedSince: only a capture read after the write can say so; then another status than the
    /// one the read was written against, or the same status in a run that began after the read, is a
    /// change.
    static func changedSince(_ read: RunWeekRead, capture: RunDesignations, listed: RunPlayerStatus?) -> Bool {
        let lastRead = capture.checkedAt ?? capture.readAt
        guard lastRead > read.writtenAt else {
            return false
        }
        let status = listed.map { $0.status.value1?.rawValue ?? $0.status.value2 ?? "" }
        if read.status != status {
            return true
        }
        return listed?.since.map { $0 > read.writtenAt } ?? false
    }

    /// readAtStatus: his read under the status caption and the next hourly pass when his designation
    /// changed since it was written, its body and call kept; as the run served it otherwise, and with no
    /// capture.
    public static func read(_ read: RunWeekRead, capture: RunDesignations?, player: String, now: Date) -> RunWeekRead {
        guard let capture,
              changedSince(read, capture: capture, listed: capture.players.additionalProperties[player])
        else {
            return read
        }
        let due = Formatting.stampAt(nextHourlyPass(after: now), zone: captionZone)
        return RunWeekRead(
            week: read.week, body: read.body, caption: changed(due: due), status: read.status, call: read.call,
            writtenAt: read.writtenAt, factsAt: read.factsAt, projection: read.projection,
            movedCaption: read.movedCaption
        )
    }
}

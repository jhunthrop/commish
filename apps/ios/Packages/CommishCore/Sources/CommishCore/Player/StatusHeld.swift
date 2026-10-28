import CommishAPI
import CommishDesign
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

    /// The months a stamp names, in order (Formatting.stampAt, en-US short).
    static let months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    /// Central's offsets from UTC in hours, daylight then standard.
    static let centralOffsetsHours: [Double] = [5, 6]
    /// The parts of "Sun Oct 18, 1:00 am CT": weekday, month, day with its comma, clock, half, zone.
    static let stampParts = 6

    /// STATUS_HELD_WORDS.changed: the caption over a read his status moved past, with the next write.
    static func changed(due: String) -> String {
        "\(Words.StatusHeld.changedLead) \(Words.StatusHeld.dueBy) \(due)."
    }

    /// stampInstant: the instant a caption-zone stamp names. The stamp carries no year, so the write's year
    /// or the next, at Central's daylight or standard offset, whichever Formatting.stampAt says back as the
    /// same stamp; nil for a stamp that does not read back.
    static func stampInstant(_ stamp: String, writtenAt: Date) -> Date? {
        let parts = stamp.split(separator: " ").map(String.init)
        guard parts.count == stampParts, parts[2].hasSuffix(","),
              let month = months.firstIndex(of: parts[1]), let day = Int(parts[2].dropLast())
        else {
            return nil
        }
        let clock = parts[3].split(separator: ":").compactMap { Int($0) }
        guard clock.count == 2 else {
            return nil
        }
        let hour24 = Double(clock[0] % 12 + (parts[4] == "pm" ? 12 : 0))
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        let year = utc.component(.year, from: writtenAt)
        for candidate in [year, year + 1] {
            let components = DateComponents(year: candidate, month: month + 1, day: day)
            guard components.isValidDate(in: utc), let midnight = utc.date(from: components) else {
                continue
            }
            for offset in centralOffsetsHours {
                let instant = midnight.addingTimeInterval((hour24 + offset) * hour + Double(clock[1]) * 60)
                if Formatting.stampAt(instant, zone: captionZone) == stamp {
                    return instant
                }
            }
        }
        return nil
    }

    /// runCaptionDue: the due time the run's own status caption names, nil when the caption is not one or
    /// its time does not read. The run builds it at its nightly, so it is true only until then.
    static func runCaptionDue(_ read: RunWeekRead) -> Date? {
        let prefix = "\(Words.StatusHeld.changedLead) \(Words.StatusHeld.dueBy) "
        guard read.caption.hasPrefix(prefix), read.caption.hasSuffix(".") else {
            return nil
        }
        return stampInstant(String(read.caption.dropFirst(prefix.count).dropLast()), writtenAt: read.writtenAt)
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

    /// statusCaption: the caption his read is shown under at `now`, nil when the capture says his
    /// designation has not changed since it was written (the one arbiter), or with no capture. The run's own
    /// caption while the time it names is still ahead (it knows a capped rewrite, Lane 275), else our next
    /// hourly pass.
    static func statusCaption(_ read: RunWeekRead, capture: RunDesignations?, player: String, now: Date) -> String? {
        guard let capture,
              changedSince(read, capture: capture, listed: capture.players.additionalProperties[player])
        else {
            return nil
        }
        if let runDue = runCaptionDue(read), runDue > now {
            return read.caption
        }
        return changed(due: Formatting.stampAt(nextHourlyPass(after: now), zone: captionZone))
    }

    /// readAtStatus: his read under the status caption (statusCaption) when his designation changed since it
    /// was written, its body and call kept; as the run served it otherwise.
    public static func read(_ read: RunWeekRead, capture: RunDesignations?, player: String, now: Date) -> RunWeekRead {
        guard let caption = statusCaption(read, capture: capture, player: player, now: now) else {
            return read
        }
        return RunWeekRead(
            week: read.week, body: read.body, caption: caption, status: read.status, call: read.call,
            writtenAt: read.writtenAt, factsAt: read.factsAt, projection: read.projection,
            movedCaption: read.movedCaption
        )
    }
}

import CommishAPI
import CommishDesign
import Foundation

/// A player's status as a row's chip draws it (web/src/lib/format/designation.ts, box.ts statusOf and
/// rowStatus, next-week.ts carriedMark), ported: the week's designation, or a season-long list's word
/// in place of his rank.
public struct RowStatus: Equatable, Sendable {
    /// The list's short word where his rank would be ("IR"), nil for a week's designation.
    public let rank: String?
    /// The chip's words: "Questionable", "Due back Sun Oct 18", "IR since Sep 28".
    public let mark: String
    /// It keeps him out (drawn as a loss).
    public let sits: Bool
    /// Questionable: a question, not a reason to sit him.
    public let question: Bool

    /// On a season-long list: no week Proj, no Opp rank, no change in either (box.ts onList).
    public var onList: Bool {
        rank != nil
    }
}

enum RowStatuses {
    typealias Designation = Components.Schemas.InjuryDesignation
    typealias Status = Components.Schemas.DesignationStatusKnown

    /// designation.ts DESIGNATION_WORDS, generated: "Questionable", "On injured reserve".
    static func word(_ status: Status) -> String {
        switch status {
        case .questionable: Words.Designation.questionable
        case .doubtful: Words.Designation.doubtful
        case .out: Words.Designation.out
        case .injuredReserve: Words.Designation.injured_reserve
        case .suspended: Words.Designation.suspended
        case .pup: Words.Designation.pup
        case .nfi: Words.Designation.nfi
        }
    }

    /// designation.ts RANK_WORDS, generated: "IR", "PUP", a status in a rank's few characters.
    static func rankWord(_ status: Status) -> String {
        switch status {
        case .questionable: Words.DesignationRank.questionable
        case .doubtful: Words.DesignationRank.doubtful
        case .out: Words.DesignationRank.out
        case .injuredReserve: Words.DesignationRank.injured_reserve
        case .suspended: Words.DesignationRank.suspended
        case .pup: Words.DesignationRank.pup
        case .nfi: Words.DesignationRank.nfi
        }
    }

    /// The short word for his status in a rank's place, a week's designation too ("O", "IR"): the
    /// designation first, else the platform's injured reserve (statusOf's order); nil with neither.
    static func rankWord(of designation: Designation?, hostIR: Bool) -> String? {
        (designation?.status.value1 ?? (hostIR ? .injuredReserve : nil)).map(rankWord)
    }

    static func seasonLong(_ status: Status, flagged: Bool) -> Bool {
        flagged || [.injuredReserve, .pup, .nfi, .suspended].contains(status)
    }

    static func sits(_ status: Status) -> Bool {
        status != .questionable && status != .doubtful
    }

    /// box.ts statusOf: the week's designation first, else the platform's injured reserve; nil with
    /// neither, or with a status this build does not know.
    static func of(_ designation: Designation?, hostIR: Bool, zone: TimeZone) -> RowStatus? {
        let known = designation?.status.value1
        guard let status = known ?? (hostIR ? .injuredReserve : nil) else {
            return nil
        }
        let listed = seasonLong(status, flagged: designation?.seasonLong == true)
        let returning = designation?.returning
        let mark: String = if listed {
            seasonLongMark(status, since: designation?.since, returning: returning, zone: zone)
        } else if let returning {
            "Due back \(calendarDay(returning, weekday: true))"
        } else {
            carriedMark(designation, zone: zone) ?? word(status)
        }
        return RowStatus(
            rank: listed ? rankWord(status) : nil, mark: mark, sits: sits(status), question: status == .questionable
        )
    }

    /// box.ts rowStatus: Questionable and Doubtful are words about a game still to come, so once his
    /// game has kicked off they drop and the platform's injured reserve, if any, stays.
    static func row(_ designation: Designation?, hostIR: Bool, toCome: Bool, zone: TimeZone) -> RowStatus? {
        guard let status = of(designation, hostIR: hostIR, zone: zone), !status.sits, !toCome else {
            return of(designation, hostIR: hostIR, zone: zone)
        }
        return of(nil, hostIR: hostIR && !dueBack(designation), zone: zone)
    }

    /// He is due back this week on a week's designation (box.ts dueBack).
    static func dueBack(_ designation: Designation?) -> Bool {
        guard let designation, designation.returning != nil, let status = designation.status.value1 else {
            return false
        }
        return !seasonLong(status, flagged: designation.seasonLong == true)
    }

    /// designation.ts seasonLongMark: "IR since Sep 22", "IR, back Nov 8", or "IR".
    static func seasonLongMark(_ status: Status, since: Date?, returning: String?, zone: TimeZone) -> String {
        let word = rankWord(status)
        if let returning {
            return "\(word), back \(calendarDay(returning, weekday: false))"
        }
        return since.map { "\(word) since \(Formatting.shortDay($0, zone: zone))" } ?? word
    }

    /// next-week.ts carriedMark: "Out, listed Oct 12", "Out, still listed", nil unless carried over.
    static func carriedMark(_ designation: Designation?, zone: TimeZone) -> String? {
        guard let designation, designation.carriedOver == true, let status = designation.status.value1 else {
            return nil
        }
        let said = word(status)
        return designation.listed.map { "\(said), listed \(Formatting.shortDay($0, zone: zone))" }
            ?? "\(said), still listed"
    }

    /// designation.ts calendarDay: an ISO day ("2026-10-18") as "Oct 18", with its weekday "Sun Oct 18",
    /// the same day on every clock.
    static func calendarDay(_ day: String, weekday: Bool) -> String {
        guard let noon = APIDecoding.parseDate("\(day)T12:00:00Z") else {
            return day
        }
        let utc = TimeZone(identifier: "UTC")!
        let date = Formatting.shortDay(noon, zone: utc)
        return weekday ? "\(Formatting.weekdayTime(noon, zone: utc).prefix(3)) \(date)" : date
    }
}

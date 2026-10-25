import CommishAPI
import CommishDesign
import Foundation

/// The record's words the web builds with a function (web/src/lib/run/record.ts, records.ts,
/// record-pair.ts and format/date.ts), ported over the generated words and held to the web's page by
/// shared/fixtures/parity/record.json.
enum RecordWords {
    /// format/date.ts: the site's dates on the Eastern clock, the one the NFL keeps.
    static let eastern = TimeZone(identifier: "America/New_York") ?? .gmt
    /// format/day-time.ts BUILD_ZONE: the clock the record's set times are said on.
    static let buildZone = TimeZone(identifier: "America/Chicago") ?? .gmt
    /// record.ts RATE_PLACES: order matched prints the run's two decimals.
    static let ratePlaces = 2

    // MARK: Dates

    /// date.ts dayLabel: "Oct 12".
    static func day(_ date: Date) -> String {
        Formatting.shortDay(date, zone: eastern)
    }

    /// date.ts weekdayLabel: "Thu Oct 15".
    static func weekdayDay(_ date: Date) -> String {
        "\(weekday(date, zone: eastern)) \(day(date))"
    }

    /// date.ts weekdayWord: "Thursday".
    static func weekdayWord(_ date: Date) -> String {
        Formatting.weekdayName(date, zone: eastern)
    }

    /// day-time.ts dayTimeStamp on the build's clock: "Thu Oct 22, 1:00 pm Central".
    static func dayTimeStamp(_ date: Date) -> String {
        "\(weekday(date, zone: buildZone)) \(Formatting.shortDay(date, zone: buildZone)), "
            + "\(Formatting.timeOfDay(date, zone: buildZone)) \(Formatting.zoneWord(buildZone))"
    }

    private static func weekday(_ date: Date, zone: TimeZone) -> String {
        String(Formatting.weekdayTime(date, zone: zone).prefix { $0 != " " })
    }

    // MARK: Figures

    /// record.ts capitalized.
    static func capitalized(_ words: String) -> String {
        words.prefix(1).uppercased() + words.dropFirst()
    }

    /// record.ts printPlaces: a figure the run rounded, its places filled out, never rounded again.
    static func printPlaces(_ value: Double, _ places: Int) -> String {
        let parts = Formatting.number(value).split(separator: ".", maxSplits: 1).map(String.init)
        let fraction = parts.count > 1 ? parts[1] : ""
        let filled = fraction.padding(toLength: max(places, fraction.count), withPad: "0", startingAt: 0)
        return "\(parts.first ?? "").\(filled)"
    }

    /// record.ts figureWords: two decimals for order matched, one for places off, "50 of 84".
    static func figure(_ score: Components.Schemas.RunScore?, _ figure: RecordFigure) -> String {
        guard let score else {
            return Words.RecordBox.none
        }
        switch figure {
        case .agreement:
            return score.agreement.map { printPlaces($0, ratePlaces) } ?? "Too few"
        case .placesOff:
            return score.placesOff.map { printPlaces($0, 1) } ?? Words.RecordBox.none
        case .starters:
            return score.startersOf == 0 ? Words.RecordBox.none : "\(score.starters) of \(score.startersOf)"
        }
    }

    /// A source's head: Ours, ADP, ESPN, Published.
    static func head(_ source: RecordSource) -> String {
        switch source {
        case .ours: Words.RecordBox.ours
        case .adp: Words.RecordBox.adp
        case .espn: Words.RecordBox.espn
        case .published: Words.RecordBox.published
        }
    }

    /// A line's score for an order.
    static func score(_ line: RunRecordLine?, _ source: RecordSource) -> Components.Schemas.RunScore? {
        guard let line else {
            return nil
        }
        switch source {
        case .ours: return line.ours
        case .adp: return line.adp?.value1
        case .espn: return line.espn?.value1
        case .published: return line.published?.value1
        }
    }

    /// Ours pooled again over the weeks that graded a yardstick (record.ts OURS_ON).
    static func oursOn(_ line: RunRecordLine?, _ source: RecordSource) -> Components.Schemas.RunScore? {
        switch source {
        case .espn: line?.oursOnEspn?.value1
        case .published: line?.oursOnPublished?.value1
        case .ours, .adp: nil
        }
    }

    /// record.ts besideOf: a yardstick's figure with ours over the same weeks.
    static func beside(_ line: RunRecordLine?, _ source: RecordSource, _ figure: RecordFigure) -> (
        value: String, ours: String?
    ) {
        let same = oursOn(line, source)
        return (
            Self.figure(score(line, source), figure),
            same.map { "\(Words.RecordBox.ours) \(Self.figure($0, figure))" }
        )
    }

    // MARK: Weeks

    /// "weeks 1 to 3", "week 1".
    static func span(_ weeks: [Int]) -> String {
        guard let first = weeks.first, let last = weeks.last else {
            return ""
        }
        return first == last ? "week \(first)" : "weeks \(first) to \(last)"
    }

    /// records.ts spanLead: "Week 7", "Weeks 8 to 18".
    static func spanLead(_ weeks: [Int]) -> String {
        let first = weeks.first ?? 0
        let last = weeks.last ?? first
        return first == last ? "Week \(first)" : "Weeks \(first) to \(last)"
    }

    static func lead(_ weeks: [RunRecordWeek]) -> String {
        capitalized(span(weeks.map(\.week)))
    }

    /// record.ts reason: a missed week's note as a clause.
    static func reason(_ week: RunRecordWeek) -> String {
        var clause = week.note ?? ""
        if clause.hasSuffix(".") {
            clause.removeLast()
        }
        if clause.hasSuffix(" that week") {
            clause.removeLast(" that week".count)
        }
        return clause.prefix(1).lowercased() + clause.dropFirst()
    }

    /// record.ts runsOf with joins: every run of weeks with the same status, missed weeks with the same
    /// reason, upcoming weeks together.
    static func runs(_ weeks: [RunRecordWeek]) -> [[RunRecordWeek]] {
        var runs: [[RunRecordWeek]] = []
        for week in weeks {
            if let last = runs.last, let first = last.first, joins(first, week) {
                runs[runs.count - 1] = last + [week]
            } else {
                runs.append([week])
            }
        }
        return runs
    }

    static func joins(_ first: RunRecordWeek, _ week: RunRecordWeek) -> Bool {
        let status = RecordBook.status(week)
        guard RecordBook.status(first) == status else {
            return false
        }
        if status == .missed {
            return reason(first) == reason(week)
        }
        return status == .upcoming
    }
}

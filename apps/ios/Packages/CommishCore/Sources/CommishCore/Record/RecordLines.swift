import CommishAPI
import CommishDesign
import Foundation

/// One line of the week list: a week, or a run of missed or upcoming weeks said once (record.ts
/// WeekLine).
struct WeekLine: Equatable, Sendable {
    let lead: String
    let text: String
    let week: RunRecordWeek?
}

/// The record's sentences over its weeks (record.ts and records.ts), ported.
enum RecordLines {
    /// record.ts gradedOfPlayed.
    static func gradedOfPlayed(_ book: RecordBook) -> (graded: Int, played: Int) {
        let graded = book.weeks.filter { RecordBook.status($0) == .graded }.count
        let missed = book.weeks.filter { RecordBook.status($0) == .missed }.count
        return (graded, graded + missed)
    }

    /// record.ts standingWords: "Graded 2 of 5 weeks played", nil before any week is played.
    static func standing(_ book: RecordBook) -> String? {
        let (graded, played) = gradedOfPlayed(book)
        return played == 0 ? nil : "Graded \(graded) of \(Formatting.plural(played, "week")) played"
    }

    /// record.ts gapWords: why the played weeks not graded are not.
    static func gaps(_ book: RecordBook, unplayed: [Int]) -> String {
        let missed = RecordWords.runs(book.weeks)
            .filter { RecordBook.status($0[0]) == .missed }
            .map { run in
                let lead = RecordWords.lead(run)
                return run.count == 1
                    ? "\(lead) was not set before kickoff, so it cannot be graded."
                    : "\(lead) were not set before kickoff, so they cannot be graded."
            }
        let waiting = book.weeks
            .filter { RecordBook.status($0) == .frozen && !unplayed.contains($0.week) }
            .map { week in
                let lead = RecordWords.lead([week])
                return "\(lead) \(gradesWhen(week.gradesFrom.map(RecordWords.weekdayWord)))."
            }
        return (missed + waiting).joined(separator: " ")
    }

    /// record.ts gradesWhen: the rule a set week waits on, with the day it usually holds when the run
    /// names one: "grades once every game's stats are in, usually Wednesday".
    static func gradesWhen(_ day: String?) -> String {
        day.map { "\(Words.Record.gradesRule), \(Words.Record.usually) \($0)" } ?? Words.Record.gradesRule
    }

    /// record.ts recordHeadline: the one figure and its caption.
    static func headline(_ book: RecordBook) -> (value: String, caption: String) {
        let graded = book.weeks.filter { RecordBook.status($0) == .graded }
        let overall = book.toDate.first { $0.position.value1 == .all }
        if let overall, let agreement = overall.ours.agreement, !graded.isEmpty {
            let beside = [RecordSource.adp, .espn, .published].lazy
                .compactMap { source in RecordWords.score(overall, source).map { (source, $0) } }.first
            let part = beside.flatMap { source, score in
                score.agreement.map { rate in
                    let printed = RecordWords.printPlaces(rate, RecordWords.ratePlaces)
                    return ". \(RecordWords.head(source)) \(printed) on the same players"
                }
            } ?? ""
            return (
                RecordWords.printPlaces(agreement, RecordWords.ratePlaces),
                "\(RecordWords.capitalized(book.statistic.agreement)), ours over "
                    + "\(RecordWords.span(graded.map(\.week))) and "
                    + "\(Formatting.plural(overall.ours.graded, "player"))\(part)."
            )
        }
        let set = book.weeks.filter { [.graded, .frozen].contains(RecordBook.status($0)) }.count
        return (
            String(graded.count),
            set == 0 ? Words.Record.noneSet : "of \(Formatting.plural(set, "week")) set graded"
        )
    }

    /// record.ts weekLines: each run of missed weeks one line, every week still to come one line.
    static func weekLines(_ weeks: [RunRecordWeek], unplayed: [Int], underway: [Int]) -> [WeekLine] {
        RecordWords.runs(weeks).map { run in
            let first = run[0]
            let status = RecordBook.status(first)
            guard status == .missed || status == .upcoming else {
                return WeekLine(
                    lead: RecordWords.lead(run), text: frozenWords(first, unplayed: unplayed, underway: underway),
                    week: first
                )
            }
            return WeekLine(lead: RecordWords.lead(run), text: runWords(run), week: nil)
        }
    }

    /// record.ts runWords.
    static func runWords(_ run: [RunRecordWeek]) -> String {
        let first = run[0]
        if RecordBook.status(first) == .missed {
            return "\(RecordWords.reason(first)), so \(run.count == 1 ? "it" : "they") cannot be graded"
        }
        return first.frozenAt.map { "set before kickoff \(RecordWords.weekdayDay($0))" }
            ?? "our first order is set before its first kickoff"
    }

    /// record.ts frozenWords: "set Tue Sep 8, graded Wed Oct 14".
    static func frozenWords(_ week: RunRecordWeek, unplayed: [Int], underway: [Int]) -> String {
        let set = "set \(week.frozenAt.map(RecordWords.weekdayDay) ?? "")"
        if RecordBook.status(week) == .graded {
            return "\(set), graded \(week.gradedAt.map(RecordWords.weekdayDay) ?? "")"
        }
        if unplayed.contains(week.week) {
            return "\(set), \(Words.Record.notPlayed)"
        }
        if underway.contains(week.week) {
            return "\(set), \(Words.Record.underway)"
        }
        return "\(set), \(gradesWhen(week.gradesFrom.map(RecordWords.weekdayDay)))"
    }

    /// records.ts weeklyLines: each set week with its own set time, the missed weeks as the record says
    /// them, the next week to set on its own line and the rest once.
    static func weeklyLines(_ weeks: [RunRecordWeek], unplayed: [Int], underway: [Int]) -> [WeekLine] {
        let coming = weeks.filter { RecordBook.status($0) == .upcoming }
        let lines = weekLines(
            weeks.filter { RecordBook.status($0) != .upcoming }, unplayed: unplayed, underway: underway
        ).map { line in
            line.week.map { WeekLine(
                lead: line.lead,
                text: setWeekText($0, unplayed: unplayed, underway: underway),
                week: $0
            ) }
                ?? line
        }
        guard let next = coming.first else {
            return lines
        }
        let nextLine = WeekLine(
            lead: RecordWords.spanLead([next.week]),
            text: next.frozenAt.map { "set before kickoff \(RecordWords.weekdayDay($0))" } ?? Words.Records.setUnknown,
            week: nil
        )
        let rest = coming.dropFirst().map(\.week)
        let restLine = rest.isEmpty ? [] : [WeekLine(
            lead: RecordWords.spanLead(rest),
            text: Words.Records.setEach,
            week: nil
        )]
        return lines + [nextLine] + restLine
    }

    /// records.ts setWeekText: "set Thu Oct 22, 1:00 pm Central, graded Wed Oct 28".
    static func setWeekText(_ week: RunRecordWeek, unplayed: [Int], underway: [Int]) -> String {
        let set = "set \(week.frozenAt.map(RecordWords.dayTimeStamp) ?? "")"
        let then: String = if RecordBook.status(week) == .graded, let graded = week.gradedAt {
            "graded \(RecordWords.weekdayDay(graded))"
        } else if unplayed.contains(week.week) {
            Words.Records.notPlayed
        } else if underway.contains(week.week) {
            Words.Records.underway
        } else {
            gradesWhen(week.gradesFrom.map(RecordWords.weekdayDay))
        }
        return "\(set), \(then)"
    }

    /// records.ts weeklyPending: "Week 7 not graded yet", "Grades once every game's stats are in,
    /// usually Wed Oct 28."; nil once a week is graded.
    static func pending(_ book: RecordBook, next: NextGrade?) -> (title: String, when: String)? {
        guard let next, !book.weeks.contains(where: { RecordBook.status($0) == .graded }) else {
            return nil
        }
        let day = book.weeks.first { $0.week == next.week }?.gradesFrom.map(RecordWords.weekdayDay)
        let game = next.lastKickoff.map(RecordWords.weekdayWord)
        let when = switch (day, game) {
        case let (nil, game?): "\(RecordWords.capitalized(Words.Record.gradesRule)), after \(game)'s game."
        default: "\(RecordWords.capitalized(gradesWhen(day)))."
        }
        return ("Week \(next.week) not graded yet", when)
    }

    /// record.ts gradedOrders: "Our preseason order, then our rest-of-season order".
    static func gradedOrders(_ book: RecordBook) -> String {
        var orders: [String] = []
        for week in book.weeks where RecordBook.status(week) == .graded {
            if let order = week.order.flatMap(orderWords), !orders.contains(order) {
                orders.append(order)
            }
        }
        return orders.enumerated()
            .map { index, order in index == 0 ? order : "our" + order.dropFirst("Our".count) }
            .joined(separator: ", then ")
    }

    /// record.ts ORDER_WORDS.
    static func orderWords(_ order: RunRecordWeek.OrderPayload) -> String? {
        switch order.value1.value1 {
        case .preseason?: Words.RecordOrder.preseason
        case .restOfSeason?: Words.RecordOrder.rest_of_season
        case nil: nil
        }
    }

    /// record.ts weekOrderWords: "Our rest-of-season order, refreshed Oct 22".
    static func weekOrder(_ week: RunRecordWeek) -> String? {
        guard let order = week.order, let named = orderWords(order) else {
            return nil
        }
        guard order.value1.value1 == .restOfSeason, let asOf = week.orderAsOf else {
            return named
        }
        return "\(named), refreshed \(RecordWords.day(asOf))"
    }

    /// records.ts weeklyOrderWords: "Our rest-of-season order, set Oct 22", the date from the week's
    /// frozen stamp, never the clock (Lane 223, B188).
    static func weeklyOrder(_ week: RunRecordWeek) -> String? {
        guard week.order != nil, let frozen = week.frozenAt else {
            return nil
        }
        return "\(Words.RecordOrder.rest_of_season), set \(RecordWords.day(frozen))"
    }

    /// records.ts beforeLine: the weeks before the weekly record with the set rule said once.
    static func before(_ fromWeek: Int) -> (lead: String, text: String)? {
        guard fromWeek > 1 else {
            return nil
        }
        return (
            fromWeek <= 2 ? "Week 1" : "Weeks 1 to \(fromWeek - 1)",
            "\(Words.RecordOrder.rest_of_season) is graded week by week from week \(fromWeek). Each week's "
                + "order is set before its first kickoff and graded as set, never as refreshed after, so a player "
                + "put on IR later keeps the rank we set. Before that the site shipped the draft board, graded "
                + "under \(Words.Records.draft)."
        )
    }
}

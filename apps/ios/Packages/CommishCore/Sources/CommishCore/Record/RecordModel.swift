import CommishAPI
import CommishDesign
import Foundation

/// One order's figure in a record's cell, with ours over the same weeks beside a yardstick's.
public struct RecordCell: Equatable, Sendable, Identifiable {
    /// Ours, ADP, ESPN, Published.
    public let head: String
    public let value: String
    /// "Ours 0.42": ours pooled again over the weeks that graded this yardstick; nil for ours and ADP.
    public let same: String?

    public init(head: String, value: String, same: String?) {
        self.head = head
        self.value = value
        self.same = same
    }

    public var id: String {
        head
    }
}

/// A line's cells for one figure, every order drawn, and whether ours trails (the weekly record accents
/// ours only where it leads every yardstick).
public struct RecordFigureCells: Equatable, Sendable {
    public let trails: Bool
    public let cells: [RecordCell]
}

/// One figure of the bug: its head and ours beside each yardstick, as pairs on the weekly record or as
/// the run's own record says them.
public struct RecordTile: Equatable, Sendable, Identifiable {
    public struct Beside: Equatable, Sendable, Identifiable {
        public let head: String
        public let value: String
        /// "ours 0.42", lower case after the yardstick's figure.
        public let ours: String?

        public var id: String {
            head
        }
    }

    public let figure: RecordFigure
    public let label: String
    /// The weekly record's pairs, each naming its leader; nil on the run's own record.
    public let pairs: [FigurePair]?
    /// The run's own record: ours, then each yardstick's figure; nil on the weekly record.
    public let ours: String?
    public let beside: [Beside]

    public var id: String {
        figure.rawValue
    }
}

/// The bug over the weeks (WeeklySection.svelte): the tiles once a week is graded, the week and when it
/// grades before (the weekly record), or the headline's one figure (the run's own before a grade).
public enum RecordBug: Equatable, Sendable {
    case tiles(standing: String?, head: String, tiles: [RecordTile], gaps: String, honest: String?)
    case pending(title: String, when: String, gaps: String)
    case headline(value: String, caption: String, gaps: String)
}

/// One line of the week list with its status words and, graded, its cells by position and figure.
public struct RecordRow: Equatable, Sendable, Identifiable {
    public let lead: String
    /// The status words, capitalized: "Set Thu Oct 22, 1:00 pm Central, graded Wed Oct 28".
    public let text: String
    /// The order the week graded: "Our rest-of-season order, set Oct 22", "Our preseason order".
    public let order: String?
    public let graded: Bool
    /// A graded week's line under its lead on a phone, its order and when it was graded with the set
    /// date said once: "Our rest-of-season order, set Oct 22, graded Wed Oct 28"; nil off a graded week.
    public let caption: String?
    /// The players graded at All, nil off a graded week.
    public let players: String?
    /// By position, then figure; nil off a graded week.
    public let cells: [String: [RecordFigure: RecordFigureCells]]?
    /// The week's ESPN sentence as the run wrote it, under its row once graded.
    public let note: String?

    public var id: String {
        lead
    }
}

/// The season to date's row.
public struct RecordToDate: Equatable, Sendable {
    public let lead: String
    public let players: String
    public let cells: [String: [RecordFigure: RecordFigureCells]]
}

/// The weekly record (or the run's own before Lane 114) as WeeklySection.svelte draws it at 390.
public struct RecordSectionModel: Equatable, Sendable {
    public let head: (title: String, what: String)?
    public let bug: RecordBug
    /// The position chips, "All" first; none with one position.
    public let positions: [String]
    /// The figure chips, capitalized: "Order matched", "Places off", "Starters right".
    public let figures: [String]
    public let sourceHeads: [String]
    public let before: (lead: String, text: String)?
    public let rows: [RecordRow]
    public let toDate: RecordToDate?
    public let basis: String

    public static func == (lhs: RecordSectionModel, rhs: RecordSectionModel) -> Bool {
        lhs.head?.title == rhs.head?.title && lhs.head?.what == rhs.head?.what && lhs.bug == rhs.bug
            && lhs.positions == rhs.positions && lhs.figures == rhs.figures && lhs.sourceHeads == rhs.sourceHeads
            && lhs.before?.lead == rhs.before?.lead && lhs.before?.text == rhs.before?.text && lhs.rows == rhs.rows
            && lhs.toDate == rhs.toDate && lhs.basis == rhs.basis
    }
}

/// One figure of a draft line: ours and ADP as their cells print them, and whether ours is accented.
public struct DraftCell: Equatable, Sendable {
    public let accented: Bool
    public let ours: String
    public let adp: String
}

/// One position's line of the draft record: ours and ADP for each figure.
public struct DraftRow: Equatable, Sendable, Identifiable {
    public let position: String
    public let players: Int
    public let cells: [RecordFigure: DraftCell]

    public var id: String {
        position
    }
}

/// A draft tile: its head, what it is, and the pair.
public struct DraftTile: Equatable, Sendable, Identifiable {
    public let figure: RecordFigure
    public let label: String
    public let key: String?
    public let pair: FigurePair

    public var id: String {
        figure.rawValue
    }
}

/// The draft record as DraftSection.svelte draws it at 390, or the line saying the next run writes it.
public struct DraftSectionModel: Equatable, Sendable {
    public let title: String
    public let what: String
    public let waiting: String?
    public let span: String?
    public let players: String?
    public let tiles: [DraftTile]
    public let honest: String?
    public let figures: [String]
    public let rows: [DraftRow]
    public let all: DraftRow?
    public let basis: String
}

/// Our record as the record page draws it at 390 (routes/(run)/record/+page.svelte): the page's name and
/// lead, the weekly record (the run's own before Lane 114) and the draft record. Pure over the run's
/// record, its schedule and the clock.
public struct RecordModel: Equatable, Sendable {
    public let title: String
    public let lead: String
    public let weekly: RecordSectionModel
    public let draft: DraftSectionModel

    public init(record run: RunRecord, schedule: RunSchedule, scoring: String, now: Date) {
        title = AppWords.Tab.record
        let own = RecordBook(own: run)
        let states = WeekStates(own, schedule: schedule, now: now)
        if let weekly = run.weekly {
            let book = RecordBook(weekly: weekly)
            let weeklyStates = WeekStates(book, schedule: schedule, now: now)
            lead = Words.Records.lead
            self.weekly = RecordSections.weekly(
                book, fromWeek: weekly.fromWeek, states: weeklyStates, next: NextGrade(book, schedule: schedule)
            )
        } else {
            lead = RecordSections.lead(own, scoring: scoring)
            weekly = RecordSections.weekly(own, fromWeek: nil, states: states, next: nil)
        }
        draft = RecordSections.draft(run)
    }
}

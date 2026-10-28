import CommishAPI
import CommishDesign
import Foundation

/// WeeklySection.svelte and DraftSection.svelte over the record's functions, ported.
enum RecordSections {
    /// record.ts recordLead: the run's own record's lead, naming only the orders drawn.
    static func lead(_ book: RecordBook, scoring: String) -> String {
        let beside = RecordPairs.drawn(book, .published) ? "ADP and the week's published projection" : "ADP"
        return "How the order we set before each week's kickoff called its games, beside \(beside), "
            + "graded in \(scoring)"
    }

    static func figureHead(_ book: RecordBook, _ figure: RecordFigure) -> String {
        switch figure {
        case .agreement: book.statistic.agreement
        case .placesOff: book.statistic.placesOff
        case .starters: book.statistic.starters
        }
    }

    static func position(_ line: RunRecordLine) -> String {
        line.position.value1?.rawValue ?? line.position.value2 ?? ""
    }

    /// The weekly record's section, or the run's own record's (fromWeek nil).
    static func weekly(_ book: RecordBook, fromWeek: Int?, states: WeekStates, next: NextGrade?) -> RecordSectionModel {
        let weekly = fromWeek != nil
        let sources = weekly ? RecordPairs.weeklySources(book) : RecordPairs.sources(book)
        let positions = book.toDate.map(position)
        let lines = weekly
            ? RecordLines.weeklyLines(book.weeks, unplayed: states.unplayed, underway: states.underway)
            : RecordLines.weekLines(book.weeks, unplayed: states.unplayed, underway: states.underway)
        let toDateAll = book.toDate.first { $0.position.value1 == .all }
        return RecordSectionModel(
            head: weekly ? (Words.Records.weekly, Words.Records.weeklyWhat) : nil,
            bug: bug(book, weekly: weekly, sources: sources, states: states, next: next),
            positions: positions.count > 1 ? positions : [],
            figures: RecordFigure.allCases.map { RecordWords.capitalized(figureHead(book, $0)) },
            sourceHeads: sources.map(RecordWords.head),
            before: fromWeek.flatMap(RecordLines.before),
            rows: lines.map { line in row(line, positions: positions, book: book, sources: sources, weekly: weekly) },
            toDate: toDateAll.map { all in
                RecordToDate(
                    lead: Words.RecordBox.toDate, players: "\(all.ours.graded) distinct",
                    cells: cellsByPosition(book.toDate, positions: positions, sources: sources, weekly: weekly)
                )
            },
            basis: basis(book, weekly: weekly)
        )
    }

    /// The bug: the tiles once the season to date carries All, else the pending week (the weekly
    /// record), else the headline.
    static func bug(
        _ book: RecordBook, weekly: Bool, sources: [RecordSource], states: WeekStates, next: NextGrade?
    ) -> RecordBug {
        let gaps = RecordLines.gaps(book, unplayed: states.unplayed)
        guard let all = book.toDate.first(where: { $0.position.value1 == .all }) else {
            if weekly, let pending = RecordLines.pending(book, next: next) {
                let pendingGaps = RecordLines.gaps(book, unplayed: states.unplayed, whenWeek: next?.week)
                return .pending(title: pending.title, when: pending.when, gaps: pendingGaps)
            }
            let headline = RecordLines.headline(book)
            return .headline(value: headline.value, caption: headline.caption, gaps: gaps)
        }
        let tiles = RecordFigure.allCases.map { figure in
            weekly
                ? RecordTile(
                    figure: figure, label: figureHead(book, figure), pairs: RecordPairs.weekly(all, figure, sources),
                    ours: nil, beside: []
                )
                : RecordTile(
                    figure: figure, label: figureHead(book, figure), pairs: nil,
                    ours: RecordWords.figure(all.ours, figure),
                    beside: sources.filter { $0 != .ours }.map { source in
                        let shown = RecordWords.beside(all, source, figure)
                        return RecordTile.Beside(
                            head: RecordWords.head(source), value: shown.value, ours: shown.ours?.lowercased()
                        )
                    }
                )
        }
        let head = weekly
            ? RecordWords.spanLead(book.weeks.filter { RecordBook.status($0) == .graded }.map(\.week))
            : RecordLines.gradedOrders(book)
        return .tiles(standing: RecordLines.standing(book), head: head, tiles: tiles, gaps: gaps, honest: book.honest)
    }

    static func row(
        _ line: WeekLine, positions: [String], book _: RecordBook, sources: [RecordSource], weekly: Bool
    ) -> RecordRow {
        let week = line.week
        let graded = week.map { RecordBook.status($0) == .graded } ?? false
        let order = week.flatMap { weekly ? RecordLines.weeklyOrder($0) : RecordLines.weekOrder($0) }
        return RecordRow(
            lead: line.lead, text: RecordWords.capitalized(line.text), order: order, graded: graded,
            caption: graded ? caption(week, order: order, text: line.text, weekly: weekly) : nil,
            players: graded ? String(week?.lines.first { $0.position.value1 == .all }?.ours.graded ?? 0) : nil,
            cells: graded
                ? cellsByPosition(week?.lines ?? [], positions: positions, sources: sources, weekly: weekly) : nil,
            note: weekly && graded ? week?.espnNote : nil
        )
    }

    /// A graded week's caption: the order with when it was graded on the weekly record (its order words
    /// carry the set date), the order with the run's own words on the record before Lane 114.
    static func caption(_ week: RunRecordWeek?, order: String?, text: String, weekly: Bool) -> String {
        guard let order else {
            return RecordWords.capitalized(text)
        }
        guard weekly, let graded = week?.gradedAt else {
            return "\(order), \(text)"
        }
        return "\(order), graded \(RecordWords.weekdayDay(graded))"
    }

    static func cellsByPosition(
        _ lines: [RunRecordLine], positions: [String], sources: [RecordSource], weekly: Bool
    ) -> [String: [RecordFigure: RecordFigureCells]] {
        Dictionary(uniqueKeysWithValues: positions.map { name in
            (name, cells(lines.first { position($0) == name }, sources: sources, weekly: weekly))
        })
    }

    /// A line's cells for every figure and order drawn.
    static func cells(
        _ line: RunRecordLine?,
        sources: [RecordSource],
        weekly: Bool
    ) -> [RecordFigure: RecordFigureCells] {
        Dictionary(uniqueKeysWithValues: RecordFigure.allCases.map { figure in
            let cells = sources.map { source in
                if source == .ours {
                    return RecordCell(
                        head: RecordWords.head(source), value: RecordWords.figure(line?.ours, figure), same: nil
                    )
                }
                let shown = RecordWords.beside(line, source, figure)
                return RecordCell(head: RecordWords.head(source), value: shown.value, same: shown.ours)
            }
            let trails = weekly && !RecordPairs.oursLeadsAll(RecordPairs.weekly(line, figure, sources))
            return (figure, RecordFigureCells(trails: trails, cells: cells))
        })
    }

    /// The phone's basis: records.ts weeklyBasis's parts both widths say (the scale, places off and the
    /// starters it counts), or the run's own record's every sentence (record.ts recordBasis).
    static func basis(_ book: RecordBook, weekly: Bool) -> String {
        let said: [String?] = weekly
            ? [book.scale, Words.Record.placesOff, book.startersBasis]
            : [book.method, book.scale, Words.Record.placesOff, book.startersBasis]
        return said.compactMap(\.self).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// The draft record's section, or its line before a run writes it.
    static func draft(_ run: RunRecord) -> DraftSectionModel {
        let heads: [RecordFigure: String] = [
            .agreement: run.statistic.agreement, .placesOff: run.statistic.placesOff, .starters: Words.Records.named,
        ]
        guard let draft = run.draft else {
            return DraftSectionModel(
                title: Words.Records.draft, what: Words.Records.draftWhat, waiting: Words.Records.waiting, span: nil,
                players: nil, tiles: [], honest: nil, figures: [], rows: [], all: nil, basis: ""
            )
        }
        let all = draft.lines.first { $0.position.value1 == .all }
        let tops = draft.lines.filter { $0.position.value1 != .all && $0.ours.startersOf > 0 }
            .map { "\($0.ours.startersOf) \($0.position.value1?.rawValue ?? $0.position.value2 ?? "")" }
        let keys: [RecordFigure: String] = [
            .placesOff: Words.Records.lowerBetter,
        ].merging(tops.isEmpty ? [:] : [.starters: "of the top \(tops.joined(separator: ", "))"]) { first, _ in first }
        return DraftSectionModel(
            title: Words.Records.draft, what: Words.Records.draftWhat, waiting: nil,
            span: all
                .map { _ in draft.throughWeek.map { "Season points through week \($0)" } ?? "No week counted yet" },
            players: all.map { Formatting.plural($0.ours.graded, "player") },
            tiles: all.map { line in
                RecordFigure.allCases.map { figure in
                    DraftTile(
                        figure: figure, label: heads[figure] ?? "", key: keys[figure],
                        pair: FigurePair(ours: line.ours, theirs: line.adp, figure: figure, name: Words.RecordBox.adp)
                    )
                }
            } ?? [],
            honest: all == nil ? nil : draft.honest,
            figures: RecordFigure.allCases.map { RecordWords.capitalized(heads[$0] ?? "") },
            rows: draft.lines.filter { $0.position.value1 != .all }.map(draftRow),
            all: all.map(draftRow),
            basis: [Words.Records.draftPositions, draft.namedBasis].compactMap(\.self).filter { !$0.isEmpty }
                .joined(separator: " ")
        )
    }

    static func draftRow(_ line: RunDraftLine) -> DraftRow {
        DraftRow(
            position: line.position.value1?.rawValue ?? line.position.value2 ?? "", players: line.ours.graded,
            cells: Dictionary(uniqueKeysWithValues: RecordFigure.allCases.map { figure in
                let pair = FigurePair(ours: line.ours, theirs: line.adp, figure: figure, name: Words.RecordBox.adp)
                return (figure, DraftCell(accented: pair.accented, ours: pair.ours, adp: pair.theirs))
            })
        )
    }
}

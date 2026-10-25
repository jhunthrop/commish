import CommishAPI
import CommishDesign
import Foundation

/// Who leads a pair (record-pair.ts PairLeader).
public enum PairLeader: String, Equatable, Sendable {
    case ours
    case theirs
    case level
}

/// One figure for ours and a yardstick at one size, the leader named under them (record-pair.ts
/// FigurePair): "level", "ours by 0.2", "ADP by 3". Ours is accented only where it leads.
public struct FigurePair: Equatable, Sendable, Identifiable {
    public let ours: String
    public let theirs: String
    /// The yardstick's name over its figure: "ADP", "ESPN".
    public let name: String
    public let leader: PairLeader?
    public let lead: String?

    public var id: String {
        name
    }

    /// record-pair.ts oursAccented.
    public var accented: Bool {
        leader == .ours
    }

    /// record-pair.ts figurePair: both printed as their cells print them, the leader by the figure's own
    /// direction (places off lower), the margin at the figure's places.
    init(
        ours: Components.Schemas.RunScore?, theirs: Components.Schemas.RunScore?, figure: RecordFigure, name: String
    ) {
        self.ours = RecordWords.figure(ours, figure)
        self.theirs = RecordWords.figure(theirs, figure)
        self.name = name
        guard let mine = ours.flatMap({ Self.units($0, figure) }),
              let other = theirs.flatMap({ Self.units($0, figure) })
        else {
            leader = nil
            lead = nil
            return
        }
        guard mine != other else {
            leader = .level
            lead = Words.Pair.level
            return
        }
        let oursAhead = figure == .placesOff ? mine < other : mine > other
        let places = Self.places(figure)
        let margin = Formatting.fixed(Double(abs(mine - other)) / pow(10, Double(places)), places)
        leader = oursAhead ? .ours : .theirs
        lead = "\(oursAhead ? Words.Pair.oursBy : name) by \(margin)"
    }

    static func places(_ figure: RecordFigure) -> Int {
        switch figure {
        case .agreement: RecordWords.ratePlaces
        case .placesOff: 1
        case .starters: 0
        }
    }

    /// record-pair.ts units: the printed figure's digits as a whole count.
    static func units(_ score: Components.Schemas.RunScore, _ figure: RecordFigure) -> Int? {
        let value: Double? = switch figure {
        case .agreement: score.agreement
        case .placesOff: score.placesOff
        case .starters: score.startersOf == 0 ? nil : Double(score.starters)
        }
        guard let value else {
            return nil
        }
        let places = places(figure)
        guard places > 0 else {
            return Int(value)
        }
        return Int(RecordWords.printPlaces(value, places).replacingOccurrences(of: ".", with: ""))
    }
}

/// The record's orders and pairs (record.ts sourceDrawn, records.ts weeklySources and weeklyPairs).
enum RecordPairs {
    /// record.ts sourceDrawn: ours always, a yardstick once the season to date carries it.
    static func drawn(_ book: RecordBook, _ source: RecordSource) -> Bool {
        source == .ours || book.toDate.contains { RecordWords.score($0, source) != nil }
    }

    /// The orders the run's own record draws (record.ts recordSources).
    static func sources(_ book: RecordBook) -> [RecordSource] {
        RecordSource.allCases.filter { drawn(book, $0) }
    }

    /// records.ts weeklySources: ours, ESPN from its first week, the published projection once graded.
    static func weeklySources(_ book: RecordBook) -> [RecordSource] {
        [.ours, .espn] + (drawn(book, .published) ? [.published] : [])
    }

    /// records.ts weeklyPairs: ours beside each yardstick drawn, ours pooled again over the weeks that
    /// graded it.
    static func weekly(_ line: RunRecordLine?, _ figure: RecordFigure, _ sources: [RecordSource]) -> [FigurePair] {
        sources.filter { $0 == .espn || $0 == .published }.map { source in
            FigurePair(
                ours: RecordWords.oursOn(line, source) ?? line?.ours, theirs: RecordWords.score(line, source),
                figure: figure, name: RecordWords.head(source)
            )
        }
    }

    /// records.ts oursLeadsAll: ours accented only where it leads every yardstick graded there.
    static func oursLeadsAll(_ pairs: [FigurePair]) -> Bool {
        let graded = pairs.filter { $0.leader != nil }
        return !graded.isEmpty && graded.allSatisfy { $0.leader == .ours }
    }
}

import CommishAPI
import CommishDesign
import Foundation

/// A format line's sentences as the player page prints them (web/src/lib/run/player-words.ts LineWords):
/// the big figure's caption, where drafters take him (its label, figure and sentence) and his value
/// among the board.
public struct LineWords: Equatable, Sendable {
    public let caption: String
    public let draftersLabel: String
    public let draftersFigure: String
    public let drafters: String
    public let value: String
}

/// His numbers in a format, from his page or, for a page held with no copy, the board's row.
struct LineNumbers: Equatable, Sendable {
    let positionRank: Int
    let ourRank: Int
    let vorRound: Int
    let adp: Double?
    let gap: Double?
    let projected: Double
    let vor: Double
    let expectedGames: Double
    let floor: Double?
    let median: Double?
    let ceiling: Double?

    init(_ numbers: RunPlayerFormat) {
        positionRank = numbers.positionRank
        ourRank = numbers.ourRank
        vorRound = numbers.vorRound
        adp = numbers.adp
        gap = numbers.gap
        projected = numbers.projected
        vor = numbers.vor
        expectedGames = numbers.expectedGames
        floor = numbers.floor
        median = numbers.median
        ceiling = numbers.ceiling
    }

    init(_ row: RunBoardRow) {
        positionRank = row.positionRank
        ourRank = row.ourRank
        vorRound = row.vorRound
        adp = row.adp
        gap = row.gap
        projected = row.projected
        vor = row.vor
        expectedGames = row.expectedGames
        floor = row.floor
        median = row.median
        ceiling = row.ceiling
    }
}

/// player-words.ts and the page's other built words, ported and held to
/// shared/fixtures/parity/player-sheet.json's pages.
enum PageWords {
    /// rest-from.ts RUN_LAST_WEEK: the run's figure stops at its last week.
    static let runLastWeek = 17
    static let belowTheAvailable = "He sits below the available players."
    static let noSource = "None of our ADP sources has him."

    /// The run ranks the rest of the season in this format (rest-words.ts restLead is not null).
    static func ranksRest(_ format: RunFormat) -> Bool {
        format.rosFromWeek != nil && format.refreshedAt != nil
    }

    /// The season a line is said in (player-words.ts lineWords' season): its year, whether the run is
    /// under way, and whether he is on a season-long list.
    struct Season {
        let year: Int
        let underway: Bool
        let heldOut: Bool
    }

    /// player-words.ts lineWords.
    static func line(
        _ format: RunFormat, numbers: LineNumbers, sources: [String], boardSize: Int?, season: Season
    ) -> LineWords {
        let (underway, heldOut) = (season.underway, season.heldOut)
        let inSeason = ranksRest(format)
        let year = String(season.year)
        let rank = heldOut ? " if he plays, below the available players" : ", our rank \(numbers.ourRank)"
        let through = max(runLastWeek, format.rosFromWeek ?? runLastWeek)
        let games = Formatting.fixed(numbers.expectedGames)
        let caption = inSeason
            ? "\(format.label) points for the rest of \(year) through week \(through)\(rank)"
            : underway
            ? "\(format.label) points in \(year), projected preseason over \(games) games"
            : "projected \(format.label) points in \(year), over \(games) expected games"
        let fact = draftersFact(numbers, inSeason: inSeason || heldOut)
        let size = boardSize.map(String.init) ?? Words.Box.none
        return LineWords(
            caption: caption,
            draftersLabel: fact.label,
            draftersFigure: fact.figure,
            drafters: heldOut ? heldDrafters(numbers, sources: sources)
                : drafters(numbers, sources: sources, inSeason: inSeason),
            value: heldOut ? heldValue(size, inSeason: inSeason) : value(numbers, size: size, inSeason: inSeason)
        )
    }

    /// draftersWords: where drafters take him against our rank, or in season his ADP alone.
    static func drafters(_ numbers: LineNumbers, sources: [String], inSeason: Bool) -> String {
        let from = sources.joined(separator: " and ")
        if inSeason {
            return numbers.adp == nil ? noSource : "His ADP in \(from), before the season."
        }
        let pick = "We have him at pick \(numbers.ourRank)"
        guard let adp = numbers.adp else {
            return "None of our ADP sources has him yet. \(pick)."
        }
        let said = "ADP \(Formatting.fixed(adp)) from \(from)."
        guard let gap = numbers.gap else {
            return "\(pick). \(said)"
        }
        let place = gap == 0 ? "drafters take him right where we would" : "drafters take him \(gapPicks(gap))"
        return "\(pick), so \(place). \(said)"
    }

    /// gap-picks.ts gapPicks: "3.5 picks later", "1.0 pick earlier".
    static func gapPicks(_ gap: Double) -> String {
        let picks = abs(gap)
        return "\(Formatting.fixed(picks)) \(picks == 1 ? "pick" : "picks") \(gap > 0 ? "later" : "earlier")"
    }

    static func draftersFact(_ numbers: LineNumbers, inSeason: Bool) -> (label: String, figure: String) {
        let place = "Where drafters take him"
        guard let adp = numbers.adp else {
            return (inSeason ? Words.Board.adp : place, "No ADP")
        }
        return inSeason ? (Words.Board.adp, Formatting.fixed(adp)) : (place, "Pick \(Formatting.fixed(adp, 0))")
    }

    static func heldDrafters(_ numbers: LineNumbers, sources: [String]) -> String {
        let adp = numbers.adp.map { "ADP \(Formatting.fixed($0)) from \(sources.joined(separator: " and "))." }
            ?? noSource
        return "\(adp) \(belowTheAvailable)"
    }

    static func heldValue(_ size: String, inSeason: Bool) -> String {
        let among = "If he plays, among the \(size) on our board\(inSeason ? " for the rest of the season" : "")."
        return "\(among) \(belowTheAvailable)"
    }

    static func value(_ numbers: LineNumbers, size: String, inSeason: Bool) -> String {
        if numbers.vor < 0 {
            return inSeason
                ? "Below replacement for the rest of the season, among the \(size) on our board"
                : "Below replacement, among the \(size) on our board"
        }
        return inSeason
            ? "Our rank \(numbers.ourRank) of the \(size) on our board for the rest of the season"
            : "Round \(numbers.vorRound) value among the \(size) on our board"
    }

    /// heldTierWords: the list he is on and that he is not ranked; nil for a week's designation.
    static func heldTier(_ status: Components.Schemas.DesignationStatusKnown) -> String? {
        switch status {
        case .injuredReserve: "On IR, not ranked"
        case .pup: "On PUP, not ranked"
        case .nfi: "On NFI, not ranked"
        case .suspended: "Suspended, not ranked"
        case .out: "Out for the season, not ranked"
        case .questionable, .doubtful: nil
        }
    }

    /// player-card.ts readStamp: "Written Oct 13, from his facts through last season".
    static func readStamp(_ capsule: RunCapsule?) -> String? {
        capsule?.writtenAt
            .map { "Written \(Formatting.shortDay($0, zone: RunWords.eastern)), \(Words.Card.writtenFrom)" }
    }

    /// player.ts clubNameOf: "Chicago Bears", a free agent's "FA".
    static func clubName(_ team: String, clubs: [RunClub]) -> String {
        guard team != Words.Figure.freeAgentClub, let club = clubs.first(where: { $0.abbr == team }) else {
            return team
        }
        return "\(club.city) \(club.nickname)"
    }
}

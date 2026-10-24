import CommishAPI
import CommishDesign
import Foundation

/// What the sides a platform lists no starters for draw (home.ts unlistedDrawn, basis.ts UnlistedDrawn).
struct UnlistedDrawn: Equatable {
    var bestLineup = false
    var noRoster = false
    var paced = false
    var skipped = false

    /// basis.ts unlistedLong.
    var long: Bool {
        bestLineup && (paced || skipped || noRoster)
    }

    /// basis.ts unlistedPhoneForm.
    var phoneForm: UnlistedForm {
        bestLineup && noRoster && paced ? .one : .short
    }

    init(_ bugs: [ScoreBug]) {
        let none = PortedWords.Box.none
        let drawn = bugs.flatMap { bug in
            bug.sides.filter(\.unlisted).compactMap { side -> (BugSide, String)? in
                let figure = bug.state == .upcoming ? side.big : side.final ? nil : side.small
                return figure.map { (side, $0) }
            }
        }
        let best = drawn.filter { $0.0.bestLineup && $0.1 != none }
        bestLineup = !best.isEmpty
        noRoster = drawn.contains { !$0.0.bestLineup && $0.1 == none }
        skipped = best.contains { $0.0.skipped }
        paced = bugs.contains { bug in
            bug.state != .upcoming && bug.sides.contains {
                $0.unlisted && $0.bestLineup && $0.paced && !$0.final && $0.small != none
            }
        }
    }
}

enum UnlistedForm {
    case full
    case short
    case one
}

/// What a crowded phone leaves out of the team sentences (home.ts TeamCuts).
struct TeamCuts: Equatable {
    var teBonus = false
    var asOf = false
    var unlistedForm = UnlistedForm.full
}

/// The League page's basis (home.ts teamBasis and standingsBasis, basis.ts parts, week-basis.ts
/// weekBasisText): a port, with no Lineup read so no Game sentence, held to the web's phone paragraph
/// by the parity file.
enum WeekBasis {
    typealias Words = PortedWords.Basis
    static let phoneRoom = (lines: 8, chars: 70)

    struct Facts {
        let host: Components.Schemas.LeagueHost
        let terms: Components.Schemas.LeagueTerms
        let board: Scoreboard?
        let bugs: [ScoreBug]
        let zone: TimeZone
    }

    /// The paragraph a phone says: whole where it fits eight lines, else the fewest cuts that fit.
    static func phone(_ facts: Facts) -> String {
        let unlisted = UnlistedDrawn(facts.bugs)
        let whole = paragraph(facts, cuts: TeamCuts())
        guard unlisted.long else {
            return whole
        }
        let short = TeamCuts(unlistedForm: unlisted.phoneForm)
        let asOf = TeamCuts(teBonus: false, asOf: true, unlistedForm: short.unlistedForm)
        let bonus = TeamCuts(teBonus: true, asOf: true, unlistedForm: short.unlistedForm)
        let said = [TeamCuts(), short, asOf, bonus].map { paragraph(facts, cuts: $0) }
        return said.first { wrappedLines($0, chars: phoneRoom.chars) <= phoneRoom.lines } ?? said.last ?? whole
    }

    static func paragraph(_ facts: Facts, cuts: TeamCuts) -> String {
        let team = facts.board.map { team(facts, board: $0, cuts: cuts) }
        return [standings(host: facts.host, terms: facts.terms), team].compactMap(\.self).filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// week-basis.ts wrappedLines: the lines a paragraph takes wrapped word by word.
    static func wrappedLines(_ text: String, chars: Int) -> Int {
        var lines = 0
        var used = 0
        for word in text.split(whereSeparator: \.isWhitespace) {
            if lines == 0 || used + 1 + word.count > chars {
                lines += 1
                used = word.count
            } else {
                used += 1 + word.count
            }
        }
        return lines
    }

    /// home.ts teamBasis, with no player's points (no Lineup read on this screen yet).
    static func team(_ facts: Facts, board: Scoreboard, cuts: TeamCuts) -> String {
        let platform = PortedWords.platform(facts.host)
        let bugs = facts.bugs
        let scoring = board.projectionScoring
        let started = bugs.contains { $0.state != .upcoming }
        let bonus = scoring.leagueOwn || cuts.teBonus ? nil : teBonusSentence(scoring.teBonus, host: facts.host)
        let when = board.projectionReadAt.map {
            "read \(Formatting.weekdayTime($0, zone: facts.zone)) \(Formatting.zoneWord(facts.zone))"
        } ?? Words.notInYet
        let said = [
            projFinalPhone(started: bugsPlaying(listedOnly(bugs)), missing: bugsMissFinal(lineupSidesOnly(bugs))),
            bugsFinalNone(bugs) ? finalNonePart(platform) : "",
            unlistedPart(platform, drawn: UnlistedDrawn(bugs), form: cuts.unlistedForm),
        ].filter { !$0.isEmpty }.joined(separator: " ")
        let asOf = started && !cuts.asOf ? ", \(Words.asOfKickoff)" : ""
        let extra = bonus.map { " \($0)" } ?? ""
        let final = said.isEmpty ? "" : " \(said)"
        let box = PortedWords.Box.self
        let whose = scoringWords(scoring, host: facts.host)
        return "A team's \(box.proj) adds its starters' published projections\(whose), \(when)\(asOf).\(extra) "
            + "\(box.pts) are \(platform)'s so far.\(final)"
    }

    /// home.ts standingsBasis.
    static func standings(host: Components.Schemas.LeagueHost, terms: Components.Schemas.LeagueTerms) -> String {
        let platform = PortedWords.platform(host)
        let home = CommishDesign.Words.LeagueHome.self
        let tiebreak = terms.tiebreak.map { "then \(PortedWords.tiebreak($0.value1))" }
            ?? "then points for, as \(platform) lists them"
        return "Standings follow \(platform)'s record, \(tiebreak). \(home.pointsFor) and \(home.pointsAgainst) are "
            + "points for and against, \(home.streak) the current run\(waiverBasis(platform, terms: terms))."
    }

    private static func waiverBasis(_ platform: String, terms: Components.Schemas.LeagueTerms) -> String {
        let home = CommishDesign.Words.LeagueHome.self
        switch terms.waivers {
        case .budget:
            let budget = terms.waiverBudget.map { " of \(Formatting.dollars($0))" } ?? ""
            return ", \(home.budget) the budget left\(budget)"
        case .order:
            let how = terms.waiverOrder.map { "\(PortedWords.waiverOrder($0.value1)), \(home.firstPicks)" }
                ?? home.firstPicks
            return ", \(home.order) the place in \(platform)'s order (\(how))"
        case nil:
            return ""
        }
    }

    // MARK: the parts (basis.ts)

    private static func scoringWords(
        _ scoring: Components.Schemas.ProjectionScoring,
        host: Components.Schemas.LeagueHost
    ) -> String {
        let format = PortedWords.format(scoring.format)
        if scoring.leagueOwn {
            return " on your rules"
        }
        guard scoring.teBonus != nil else {
            return ", \(format) nearest your rules"
        }
        return ", \(format) shown, nearest \(rulesOwner(host))'s rules"
    }

    private static func teBonusSentence(_ bonus: Double?, host: Components.Schemas.LeagueHost) -> String? {
        let owner = sentenceStart(rulesOwner(host))
        return bonus.map { "\(owner) adds \(Formatting.number($0)) a catch for TEs." }
    }

    /// names.ts rulesOwner: FFPC fixes its own rules; on any other platform the league's commissioner does.
    private static func rulesOwner(_ host: Components.Schemas.LeagueHost) -> String {
        host == .ffpc ? PortedWords.platform(host) : "your league"
    }

    private static func sentenceStart(_ words: String) -> String {
        words.prefix(1).uppercased() + words.dropFirst()
    }

    private static func projFinalPhone(started: Bool, missing: Bool) -> String {
        guard started else {
            return ""
        }
        return missing ? Words.noProjFinalPart : Words.projFinalPart
    }

    private static func finalNonePart(_ platform: String) -> String {
        "A \(PortedWords.Box.final) of \(PortedWords.Box.none) is a score \(platform) does not send us."
    }

    private static func unlistedPart(_ platform: String, drawn: UnlistedDrawn, form: UnlistedForm) -> String {
        let box = PortedWords.Box.self
        let from = drawn.skipped ? Words.fromProjected : Words.fromRosters
        let paceWords = form == .full ? Words.paceClause : Words.paceClauseShort
        let pace = drawn.paced ? ", \(paceWords)" : ""
        if form == .one, drawn.bestLineup, drawn.noRoster {
            return "Teams \(platform) sends no lineup for show our best lineup from \(from)\(pace), "
                + "or \(box.none) with none."
        }
        let best = drawn.bestLineup
            ? "\(box.proj) for teams \(platform) sends no lineup for is our best lineup from \(from)\(pace)." : ""
        let none = drawn.noRoster ? "Teams \(platform) sends no lineup or roster for show \(box.none)." : ""
        return [best, none].filter { !$0.isEmpty }.joined(separator: " ")
    }

    // MARK: the bugs' flags (home.ts)

    private static func lineupSidesOnly(_ bugs: [ScoreBug]) -> [ScoreBug] {
        bugs.map { $0.with(sides: $0.sides.filter { !$0.unlisted || $0.bestLineup }) }
    }

    private static func listedOnly(_ bugs: [ScoreBug]) -> [ScoreBug] {
        bugs.map { $0.with(sides: $0.sides.filter { !$0.unlisted }) }
    }

    private static func bugsMissFinal(_ bugs: [ScoreBug]) -> Bool {
        bugs.contains { bug in
            bug.state != .upcoming && bug.sides.contains { !$0.final && $0.small == PortedWords.Box.none }
        }
    }

    private static func bugsPlaying(_ bugs: [ScoreBug]) -> Bool {
        bugs.contains { bug in bug.state != .upcoming && bug.sides.contains { !$0.final } }
    }

    private static func bugsFinalNone(_ bugs: [ScoreBug]) -> Bool {
        bugs.contains { bug in bug.sides.contains { $0.final && $0.small.hasSuffix(PortedWords.Box.none) } }
    }
}

extension ScoreBug {
    func with(sides: [BugSide]) -> ScoreBug {
        ScoreBug(id: id, mine: mine, state: state, head: head, words: words, small: small, big: big, sides: sides)
    }
}

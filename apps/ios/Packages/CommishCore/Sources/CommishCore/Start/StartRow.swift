import CommishAPI
import CommishDesign
import Foundation

/// His game in a row's cell: the opponent and the kickoff or the state's word, a bye, a free agent's
/// none, or none held (box.ts RowGame).
public enum RowGame: Equatable, Sendable {
    case game(where: String, when: String)
    case bye
    case noClub
    case none
}

/// The kickoff weather in a few words with its glyph (box.ts WeatherCell).
public struct WeatherCell: Equatable, Sendable {
    public let glyph: String
    public let words: String
}

/// How easy his opponent is at his position: the top third of points allowed easy, the bottom third
/// hard (box.ts Ease). The rank prints with it, so the tint is never the only channel.
public enum Ease: String, Equatable, Sendable {
    case easy
    case hard
    case even
}

/// One row of the Lineup's box score (box.ts BoxRow), as the phone draws it.
public struct StartRow: Equatable, Sendable, Identifiable {
    /// His platform id: the row's key and the player sheet's.
    public let id: String
    public let boardID: String?
    public let slot: String
    public let name: String
    /// His name in one line where the whole does not fit (box.ts fitName).
    public let fit: String
    public let slug: String?
    /// A defense's club mark in place of a face.
    public let clubMark: Bool
    public let club: String
    public let position: String
    /// His rank at his position in our order, nil unranked, on a list, or a defense.
    public let rank: Int?
    public let status: RowStatus?
    public let reserve: Bool
    public let game: RowGame
    public let expected: String?
    public let weather: WeatherCell?
    public let proj: Double?
    public let pts: Double?
    public let read: GameRead
    public let oppRank: Int?
    public let oppOf: Int?
    public let avg: Double?
    public let last: Double?
    public let delta: Double?
    /// His rest-of-season points a game on our board, the Trades screen's last cell (box.ts
    /// RowEvidence.season).
    public let season: Double?

    /// Still to come at the screen's clock: the Opp rank's tint draws only then.
    public var toCome: Bool {
        read.toPlay
    }

    /// box.ts reserveRow: an injured reserve row draws no game, expected score, weather or Opp rank,
    /// and in the IR slot no Proj and no points.
    func reserved(_ reserve: ReserveRow?) -> StartRow {
        guard let reserve else {
            return self
        }
        let slotted = reserve == .slot
        return StartRow(
            id: id, boardID: boardID, slot: slot, name: name, fit: fit, slug: slug, clubMark: clubMark, club: club,
            position: position, rank: rank, status: status, reserve: self.reserve, game: .none, expected: nil,
            weather: nil, proj: slotted ? nil : proj, pts: slotted ? nil : pts, read: read, oppRank: nil, oppOf: nil,
            avg: avg, last: last, delta: slotted ? nil : delta, season: season
        )
    }
}

/// Where an injured reserve row sits: taking a bench spot, or in the platform's IR slot.
public enum ReserveRow: Equatable, Sendable {
    case bench
    case slot
}

/// box.ts boxRow and its cells, over the API's player line.
enum StartRows {
    static let freeAgentClub = Words.Figure.freeAgentClub
    static let rankedClubs = 32
    static let precipitationNamedFrom = 20.0

    /// `ranked` false draws no rank (box.ts boxRow's ranked: the Trades' rows, a roster not a lineup).
    static func row(_ line: PlayerLine, slot: String, zone: TimeZone, now: Date, ranked: Bool = true) -> StartRow {
        let facts = line.facts
        let player = line.player
        let read = LineRead.game(line, now: now)
        let status = RowStatuses.row(
            facts.designation?.value1, hostIR: player.injuredReserve, toCome: read.toPlay, zone: zone
        )
        let listed = status?.onList == true
        let mark = player.position == "DEF" && !player.team.isEmpty
        return StartRow(
            id: player.hostId, boardID: player.boardId, slot: slot, name: player.name,
            fit: mark ? lastName(withoutDefense(player.name)) : initialName(player.name),
            slug: line.slug, clubMark: mark, club: player.team, position: positionWord(player.position),
            rank: ranked && ["QB", "RB", "WR", "TE", "K", "DST"].contains(player.position) && !listed
                ? line.positionRank : nil,
            status: status, reserve: onReserve(line), game: game(line, read: read, zone: zone),
            expected: read.toPlay ? expected(facts) : nil, weather: read.toPlay ? weather(facts) : nil,
            proj: listed ? nil : line.weekProjection, pts: facts.pointsThisWeek, read: read,
            oppRank: listed ? nil : line.oppRank, oppOf: listed ? nil : facts.allowedToPosition?.value1.of,
            avg: line.seasonAvg, last: line.lastPoints, delta: listed ? nil : line.projectionDelta,
            season: line.restOfSeasonPerGame
        )
    }

    /// box.ts gameOf: "vs LAC" and "Sun 3:25 pm", or the state's word once it has kicked off.
    static func game(_ line: PlayerLine, read: GameRead, zone: TimeZone) -> RowGame {
        let facts = line.facts
        if line.player.team == freeAgentClub {
            return .noClub
        }
        if facts.bye {
            return .bye
        }
        guard let opponent = facts.opponent else {
            return .none
        }
        let place = "\(facts.home == false ? "at" : "vs") \(opponent)"
        switch read {
        case .final: return .game(where: place, when: LineRead.word(line, read: read, own: Words.Box.final))
        case .kickedOff: return .game(where: place, when: LineRead.word(line, read: read, own: Words.Box.kickedOff))
        case let .unread(word?): return .game(where: place, when: word)
        default: return .game(where: place, when: facts.kickoff.map { Formatting.weekdayTime($0, zone: zone) } ?? "")
        }
    }

    /// box.ts onReserve.
    static func onReserve(_ line: PlayerLine) -> Bool {
        let designation = line.facts.designation?.value1
        return (line.player.injuredReserve && !RowStatuses.dueBack(designation))
            || designation?.status.value1 == .injuredReserve
    }

    /// box.ts expectedWords: "20 to 22.5", his club's first.
    static func expected(_ facts: Components.Schemas.WeekFacts) -> String? {
        guard let total = facts.gameTotal?.value1 else {
            return nil
        }
        return "\(halves(total.teamPoints)) to \(halves(total.points - total.teamPoints))"
    }

    /// box.ts weatherCell.
    static func weather(_ facts: Components.Schemas.WeekFacts) -> WeatherCell? {
        let roof = facts.roof?.value1
        if roof?.abroad == true {
            return WeatherCell(glyph: "abroad", words: Words.Box.abroad)
        }
        switch roof?.kind.value1 {
        case .dome: return WeatherCell(glyph: "indoors", words: Words.Box.indoors)
        case .retractable: return WeatherCell(glyph: "roof", words: Words.Box.roofOpen)
        default: break
        }
        let weather = facts.weather?.value1
        var parts: [String] = []
        if let temperature = weather?.temperatureF {
            parts.append("\(jsRound(temperature))°")
        }
        if let wind = weather?.windMph {
            parts.append("\(jsRound(wind)) mph")
        }
        if let chance = weather?.precipitationChance, chance >= precipitationNamedFrom {
            let kind = weather?.precipitationKind?.value1
            let what = kind == .snow ? "snow" : kind == .ice ? "ice" : "rain"
            parts.append("\(jsRound(chance))% \(what)")
        }
        if !parts.isEmpty {
            return WeatherCell(glyph: "wind", words: parts.joined(separator: ", "))
        }
        return roof == nil ? nil : WeatherCell(glyph: "outdoors", words: Words.Box.outdoors)
    }

    /// box.ts easeOf.
    static func ease(_ rank: Int, outOf clubs: Int?) -> Ease {
        let ranked = Double(clubs ?? rankedClubs)
        if Double(rank) > ranked * 2 / 3 {
            return .easy
        }
        return Double(rank) <= ranked / 3 ? .hard : .even
    }

    /// box.ts positionWord: a defense is "D/ST".
    static func positionWord(_ position: String) -> String {
        position == "DEF" ? "D/ST" : position
    }

    /// game-facts.ts halves: a whole number as it is, else one decimal.
    static func halves(_ points: Double) -> String {
        points == points.rounded() ? Formatting.number(points) : Formatting.fixed(points, 1)
    }

    /// JavaScript's Math.round: half up, toward positive infinity.
    static func jsRound(_ value: Double) -> Int {
        Int((value + 0.5).rounded(.down))
    }

    /// draft.ts lastName: the last word, or the one before a suffix.
    static func lastName(_ name: String) -> String {
        let parts = name.split(whereSeparator: \.isWhitespace).map(String.init)
        guard let tail = parts.last else {
            return name
        }
        return ["Jr.", "Sr.", "II", "III", "IV", "V"].contains(tail) && parts.count > 2
            ? parts[parts.count - 2] : tail
    }

    /// "Saints" from "Saints D/ST": a defense named by its club.
    static func withoutDefense(_ name: String) -> String {
        name.replacingOccurrences(of: #"\s+D/ST$"#, with: "", options: .regularExpression)
    }

    /// box.ts initialName: "A. Rodgers", a one-word name as it is.
    static func initialName(_ name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        let first = trimmed.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? ""
        let last = lastName(trimmed)
        return first == last ? trimmed : "\(first.prefix(1)). \(last)"
    }
}

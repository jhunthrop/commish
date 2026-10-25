import CommishAPI
import CommishDesign
import Foundation

/// The card's six figures (web/src/lib/server/pages/player-card.ts cardBuild and restTile, the tiles as
/// built from his page; week-words.ts liveCard, the week's read over them; card.ts listedTiles and
/// shelf.ts gameTiles), as values and labels: their captions are the basis lines' to say once.
enum CardTiles {
    typealias Facts = Components.Schemas.WeekFacts
    static let none = Words.Card.none
    /// format-ids.ts DEFAULT_TEAMS: the league size the API values a run format at.
    static let defaultTeams = 12

    /// The tiles once the week is read, in the card's order: Proj, Rest of season, Opp rank, Avg,
    /// Last and the change.
    static func live(_ input: CardInput, read: RunWeekRead?, game: GameRead) -> [CardTile] {
        let week = input.week
        let built = builtTiles(page: input.page, format: input.format, projected: input.projected)
        let after = week.line.facts.bye ? week.afterBye?.value1 : nil
        return [
            projTile(week),
            restTile(week, input: input, fallback: built.rest),
            after.map(afterByeOppTile) ?? oppTile(week),
            avgTile(week, fallback: built.avg),
            lastTile(week, fallback: built.last),
            after.map(afterByeProjTile) ?? deltaTile(week, read: read, game: game),
        ]
    }

    /// card.ts listedTiles: a player on a season-long list ("IR") has his list in place of the week's
    /// Proj, Opp rank and change.
    static func listed(_ tiles: [CardTile], listed: String?) -> [CardTile] {
        guard listed != nil else {
            return tiles
        }
        return tiles.map { tile in
            switch tile.key {
            case .proj, .opp: tile.with(value: none, tone: .some(nil))
            case .delta: tile.with(value: none, tone: .quiet)
            case .rest, .avg, .last: tile
            }
        }
    }

    /// shelf.ts gameTiles: his Pts in place of Proj once his game has kicked off, by the line's field.
    static func played(_ tiles: [CardTile], game: GameRead, points: Double?) -> [CardTile] {
        guard game == .kickedOff || game == .final else {
            return tiles
        }
        return tiles.map { tile in
            tile.key == .proj ? tile.with(label: Words.Box.pts, value: points.map(tenth) ?? none) : tile
        }
    }

    // MARK: The tiles as built from his page

    struct Built {
        let rest: CardTile
        let avg: CardTile
        let last: CardTile
    }

    /// player-card.ts cardBuild and restTile: rest of season (or the season's projection on a preseason
    /// board) in the page's format, Avg and Last from his season so far; "--" with no page.
    static func builtTiles(page: RunPlayer?, format: RunFormat?, projected: Double? = nil) -> Built {
        let figure = format.flatMap { page?.formats.additionalProperties[$0.id] }?.projected ?? projected
        let preseason = format != nil && format?.rosFromWeek == nil
        let last = page?.season.log.last { $0.status.value1 == .played && $0.points != nil }?.points
        return Built(
            rest: CardTile(
                key: .rest, label: preseason ? Words.Card.projected : Words.Card.rest,
                value: figure.map { Formatting.fixed($0) } ?? none, tone: nil
            ),
            avg: CardTile(
                key: .avg, label: Words.Card.avg,
                value: page?.season.pointsPerGame.map { Formatting.fixed($0) } ?? none, tone: nil
            ),
            last: CardTile(
                key: .last,
                label: Words.Card.last,
                value: last.map { Formatting.fixed($0) } ?? none,
                tone: nil
            )
        )
    }

    // MARK: The week's tiles

    /// figure-words.ts weekHead: "Wk 6".
    static func weekHead(_ week: Int) -> String {
        "\(Words.Figure.week) \(week)"
    }

    /// box.ts printTenth: the API's tenth as JavaScript prints it, "11.0" for a whole one.
    static func tenth(_ value: Double) -> String {
        StartWords.number(value)
    }

    static func projTile(_ week: PlayerWeek) -> CardTile {
        CardTile(
            key: .proj,
            label: weekHead(week.week),
            value: week.line.weekProjection.map(tenth) ?? none,
            tone: .lead
        )
    }

    /// The week's Rest of season: the read's figure in the page's format once the run ranks the rest
    /// of the season (format-ids.ts apiFormatOf names the API's format), the page's as built otherwise.
    static func restTile(_ week: PlayerWeek, input: CardInput, fallback: CardTile) -> CardTile {
        guard let format = input.format, format.rosFromWeek != nil else {
            return fallback
        }
        let board = format.teams == defaultTeams && format.id.hasSuffix("-\(defaultTeams)")
            ? String(format.id.dropLast("-\(defaultTeams)".count)).replacingOccurrences(of: "-", with: "_")
            : nil
        let figure = week.restOfSeason?.first { ($0.format.value1?.rawValue ?? $0.format.value2) == board }
        return figure.map { fallback.with(value: tenth($0.points)) } ?? fallback
    }

    static func oppTile(_ week: PlayerWeek) -> CardTile {
        let line = week.line
        guard let rank = line.oppRank else {
            return CardTile(key: .opp, label: Words.Card.opp, value: none, tone: nil)
        }
        let ranked = line.facts.allowedToPosition?.value1.of
        return CardTile(key: .opp, label: Words.Card.opp, value: Formatting.ordinal(rank), tone: tone(rank, of: ranked))
    }

    /// On his bye the opponent tile reads his next game's (Lane 100, B30).
    static func afterByeOppTile(_ after: Components.Schemas.PlayerAfterBye) -> CardTile {
        guard let rank = after.line.oppRank else {
            return CardTile(key: .opp, label: Words.Card.opp, value: none, tone: nil)
        }
        let ranked = after.line.facts.allowedToPosition?.value1.of
        return CardTile(key: .opp, label: Words.Card.opp, value: Formatting.ordinal(rank), tone: tone(rank, of: ranked))
    }

    static func tone(_ rank: Int, of clubs: Int?) -> CardTile.Tone {
        switch StartRows.ease(rank, outOf: clubs) {
        case .easy: .easy
        case .hard: .hard
        case .even: .even
        }
    }

    static func avgTile(_ week: PlayerWeek, fallback: CardTile) -> CardTile {
        week.line.seasonAvg.map { fallback.with(value: tenth($0)) } ?? fallback
    }

    static func lastTile(_ week: PlayerWeek, fallback: CardTile) -> CardTile {
        guard let last = week.line.lastPoints, !week.line.facts.lastGames.isEmpty else {
            return fallback
        }
        return fallback.with(value: tenth(last))
    }

    /// On his bye the change's tile gives his next game's Proj.
    static func afterByeProjTile(_ after: Components.Schemas.PlayerAfterBye) -> CardTile {
        CardTile(
            key: .delta, label: "\(weekHead(after.week)) \(Words.Card.proj)",
            value: after.line.weekProjection.map(tenth) ?? none, tone: .quiet
        )
    }

    /// The change while his game is to come (or his bye), shown from the threshold; "--" once it has
    /// kicked off, and for a free agent, who has no game.
    static func deltaTile(_ week: PlayerWeek, read: RunWeekRead?, game: GameRead) -> CardTile {
        let line = week.line
        guard line.player.team != Words.Figure.freeAgentClub, game.toPlay || line.facts.bye else {
            return CardTile(key: .delta, label: Words.Card.delta, value: none, tone: .quiet)
        }
        let move = moveOf(week, read: read)
        return CardTile(
            key: .delta, label: Words.Card.delta, value: StartWords.delta(move.crosses ? move.change : nil),
            tone: .quiet
        )
    }

    /// week-words.ts moveOf: from the read's quoted figure when a read was written for this week, else
    /// from the earlier snapshot.
    static func moveOf(_ week: PlayerWeek, read: RunWeekRead?) -> ProjectionMove {
        let quoted = read.flatMap { $0.week == week.week ? QuotedProjection($0) : nil } ?? .notNamed
        return ProjectionMove.of(now: week.line.weekProjection, quoted: quoted, earlier: week.line.projectionDelta)
    }
}

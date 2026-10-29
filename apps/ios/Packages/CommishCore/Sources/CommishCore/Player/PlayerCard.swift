import CommishAPI
import CommishDesign
import Foundation

/// One of the card's figures as a cell (card.ts CardTile, its caption left to the basis lines): what it
/// is, the figure, and its tone.
public struct CardTile: Equatable, Sendable, Identifiable {
    public enum Key: String, Sendable {
        case proj
        case rest
        case opp
        case avg
        case last
        case delta
    }

    /// card.ts TileTone: the accent for the week's figure, his opponent's ease, quiet for the change.
    public enum Tone: String, Sendable {
        case lead
        case easy
        case hard
        case even
        case quiet
    }

    public let key: Key
    public let label: String
    /// "21.8", "26th", or "--" without a figure.
    public let value: String
    public let tone: Tone?

    public var id: Key {
        key
    }

    func with(label: String? = nil, value: String? = nil, tone: Tone?? = nil) -> CardTile {
        CardTile(key: key, label: label ?? self.label, value: value ?? self.value, tone: tone ?? self.tone)
    }
}

/// The card's head (card.ts CardHead): the week the card shows and his game in it ("at NYJ", "Bye").
public struct CardHead: Equatable, Sendable {
    public let week: Int
    public let opponent: String

    /// CardNext.svelte's week: "Week 6".
    public var label: String {
        "\(Words.Card.week) \(week)"
    }
}

/// The week ahead's cell under his name (week-words.ts NextCell): "at ATL", "Sun 12:00 pm CT", then the
/// expected score and the weather while his game is still to be played.
public struct NextCell: Equatable, Sendable {
    public let place: String
    public let when: String
    public let expected: String?
    public let weather: WeatherCell?
}

/// His read's place on the sheet: the week's read as the shelf shows it, or with none written for him
/// the words that say so.
public enum SheetRead: Equatable, Sendable {
    case shown(ShownRead)
    case none(String)
}

/// The sheet's body (the web's player shelf once his week is read, PlayerShelf.svelte over
/// week-words.ts liveCard and shelf.ts gameTiles): his game, the six figures as cells, the read, the
/// basis lines once, and his status from the week's line. Pure, held to
/// shared/fixtures/parity/player-sheet.json.
public struct PlayerCard: Equatable, Sendable {
    /// Nil where the run holds no week ahead for him.
    public let head: CardHead?
    public let cell: NextCell?
    public let tiles: [CardTile]
    public let basis: [String]
    /// Nil where his page could not be read: the shelf then draws no read.
    public let read: SheetRead?
    /// His designation as the week's line has it ("Questionable", "IR since Sep 24").
    public let status: RowStatus?
    /// His game this week by the line's field, the one rule the tiles and the read follow.
    public let game: GameRead
}

/// What the card is built from: his week from the API, his page from the run (nil where it cannot be
/// read) in the format the page leads with, the run's season, the capture beside the run, whether the
/// week was read in the member's league, and the screen's clock and zone.
public extension PlayerCard {
    /// The card as the page draws it: its read, its basis and his status left to the page's own
    /// sections (the status in the page's head, from the run's capture).
    var onPage: PlayerCard {
        PlayerCard(head: head, cell: cell, tiles: tiles, basis: [], read: nil, status: nil, game: game)
    }
}

public struct CardInput: Sendable {
    public let week: PlayerWeek
    public let page: RunPlayer?
    public let format: RunFormat?
    public let season: Int
    public let capture: RunDesignations?
    public let league: Bool
    public let zone: TimeZone
    public let now: Date
    /// His figure in the format where no page carries it (a held page's board row), else nil.
    public let projected: Double?

    public init(
        week: PlayerWeek, page: RunPlayer?, format: RunFormat?, season: Int, capture: RunDesignations?,
        league: Bool, zone: TimeZone, now: Date, projected: Double? = nil
    ) {
        self.week = week
        self.page = page
        self.format = format
        self.season = season
        self.capture = capture
        self.league = league
        self.zone = zone
        self.now = now
        self.projected = projected
    }
}

public enum PlayerCards {
    /// The card at the input's clock.
    public static func card(_ input: CardInput) -> PlayerCard {
        let line = input.week.line
        let game = LineRead.game(line, now: input.now)
        let status = RowStatuses.row(
            line.facts.designation?.value1, hostIR: line.player.injuredReserve, toCome: game.toPlay, zone: input.zone
        )
        let listed = status?.rank
        // The newer of the run's read and the answer's live one (Lane 284), judged by the status rule.
        let read = WeekReads.newest(run: input.page?.weekRead?.value1, live: input.week.weekRead?.value1).map {
            StatusHeld.read($0, capture: input.capture, player: input.page?.id ?? "", now: input.now)
        }
        let tiles = CardTiles.live(input, read: read, game: game)
        return PlayerCard(
            head: head(input, game: game),
            cell: cell(input, game: game, listed: listed != nil),
            tiles: CardTiles.played(
                CardTiles.listed(tiles, listed: listed),
                game: game,
                points: line.facts.pointsThisWeek
            ),
            basis: CardBasis.lines(
                input.week,
                league: input.league && input.week.verb != nil,
                now: input.now,
                listed: listed != nil,
                read: read
            ),
            read: sheetRead(input, read: read, game: game),
            status: status,
            game: game
        )
    }

    /// The read as the shelf shows it beside the card's projection, the not-written words with none, and
    /// nothing where his page could not be read.
    static func sheetRead(_ input: CardInput, read: RunWeekRead?, game: GameRead) -> SheetRead? {
        guard input.page != nil else {
            return nil
        }
        let state = readState(game)
        guard let read else {
            return .none(WeekReads.noRead(state, due: input.page?.weekReadsDue?.value1, now: input.now))
        }
        let week = input.week
        let card = CardProjection(
            week: week.week, ppr: week.projectionScoring.format.value1 == .ppr, points: week.line.weekProjection,
            state: state
        )
        return .shown(WeekReads.shown(read, card: card))
    }

    /// His game's state as the read is judged by (kickoff.ts lineState): none on a bye or with no game,
    /// and a state this build does not read held as still to come.
    static func readState(_ game: GameRead) -> GameRead? {
        switch game {
        case .upcoming, .kickedOff, .final: game
        case .noGame, .unread: nil
        }
    }

    /// week-words.ts headOf: the API's week, and the game or the bye in it.
    static func head(_ input: CardInput, game: GameRead) -> CardHead {
        let opponent = switch StartRows.game(input.week.line, read: game, zone: input.zone) {
        case let .game(place, _): place
        case .bye: Words.Box.bye
        case .noClub: Words.Box.noClub
        case .none: Words.Box.none
        }
        return CardHead(week: input.week.week, opponent: opponent)
    }

    /// week-words.ts nextOf: the expected score and the weather only while his game is still to be
    /// played (and he is on no season-long list), the kickoff with its zone, "Kicked off" or "Final" after.
    static func cell(_ input: CardInput, game: GameRead, listed: Bool) -> NextCell? {
        let line = input.week.line
        guard case let .game(place, when) = StartRows.game(line, read: game, zone: input.zone) else {
            return nil
        }
        let ahead = game.toPlay && !listed
        let kickoff = game.toPlay ? line.facts.kickoff.map { Formatting.kickoffAt($0, zone: input.zone) } : nil
        return NextCell(
            place: place,
            when: kickoff ?? when,
            expected: ahead ? expectedScore(line.facts, club: line.player.team) : nil,
            weather: ahead ? StartRows.weather(line.facts) : nil
        )
    }

    /// box.ts expectedScoreWords: "Expected score DET 28.5, GB 25", each club named.
    static func expectedScore(_ facts: Components.Schemas.WeekFacts, club: String) -> String? {
        guard let total = facts.gameTotal?.value1, let opponent = facts.opponent else {
            return nil
        }
        let theirs = total.points - total.teamPoints
        return "Expected score \(club) \(StartRows.halves(total.teamPoints)), \(opponent) \(StartRows.halves(theirs))"
    }
}

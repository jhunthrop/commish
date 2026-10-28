import CommishAPI
import CommishDesign
import Foundation

/// The builder's picks (builder.ts Picks): the other team by roster id, nil before one is chosen, and
/// each side's players by host id.
public struct TradePicks: Equatable, Sendable {
    public let team: Int?
    public let give: [String]
    public let get: [String]

    public init(team: Int?, give: [String], get: [String]) {
        self.team = team
        self.give = give
        self.get = get
    }

    /// The side a tap picks on: the member's give, or their get.
    public enum Side: Sendable {
        case give
        case get
    }

    func players(_ side: Side) -> [String] {
        side == .give ? give : get
    }

    /// builder.ts toggle: picked when the side has room, put back when he is picked; a third waits.
    func tapped(_ side: Side, _ id: String) -> TradePicks {
        let list = players(side)
        let next = list.contains(id) ? list.filter { $0 != id } : list.count < TradeBuilder
            .maxASide ? list + [id] : list
        return side == .give ? TradePicks(team: team, give: next, get: get) : TradePicks(
            team: team,
            give: give,
            get: next
        )
    }

    /// builder.ts checkInput: the check to ask once a team is chosen and both sides hold a player.
    var checkInput: TradeCheckInput? {
        guard let team, !give.isEmpty, !get.isEmpty else {
            return nil
        }
        return TradeCheckInput(team: team, give: give, get: get)
    }
}

/// A roster row's tick (BoxPick): picked or not (held back while the side is full), none for a player
/// no trade takes, or the member's drop.
public enum PickTick: Equatable, Sendable {
    case picked
    case open(disabled: Bool)
    case none
    case drop
}

/// One roster row of the builder (TradeBox's BoxLine at 390): the box's cells, the phone's line (Avg
/// and Last, no Opp rank), his tick.
public struct BuilderRow: Equatable, Sendable, Identifiable {
    public let cells: RowCells
    public let line: String
    public let tick: PickTick

    public var id: String {
        cells.id
    }
}

/// One roster as the builder's box draws it: the team, "You" on the member's, its standing, what the
/// side holds, its rows in the builder's order.
public struct BuilderBox: Equatable, Sendable {
    public let team: String
    public let initials: String
    public let mine: Bool
    public let aside: String
    public let holds: String
    public let rows: [BuilderRow]
}

/// The builder (TradeBuilder.svelte at 390): the team chosen by name and record, the scoreboard of each
/// side before and after, the answer line and the close call's chip, the builder's own line, the
/// member's roster then theirs, and the pin with the gains and the verb.
public struct TradeBuilderModel: Equatable, Sendable {
    public struct TeamChoice: Equatable, Sendable, Identifiable {
        public let id: Int
        public let choice: String
    }

    public let teams: [TeamChoice]
    public let team: Int?
    public let bug: TradeBug
    public let sentence: String
    /// The answer line is the prompt, not an answer: drawn quieter.
    public let quiet: Bool
    public let close: String?
    public let own: String
    public let yours: BuilderBox
    public let theirs: BuilderBox?
    /// "+5.7 a week for your lineup, +0.7 for theirs" once answered, its first figure strong; the answer
    /// line before.
    public let pin: Pin
    public let verbEnabled: Bool

    public enum Pin: Equatable, Sendable {
        case gains(mine: String, rest: String)
        case words(String)
    }
}

/// The member's side as the builder names it: the team and where it stands.
public struct TradeMe: Equatable, Sendable {
    public let name: String
    public let aside: String

    public init(name: String, aside: String) {
        self.name = name
        self.aside = aside
    }

    /// The followed league's team and standing (TradeScreen's me: the switch's team name and
    /// model.ts standingWords, "5-1, 2nd of 12"); "You" for a league saved before the app kept its team
    /// (review L3).
    public init(league: FollowedLeague) {
        let team = league.teamName ?? ""
        name = team.isEmpty ? Words.Box.you : team
        aside = league.standing.map { standing in
            let record = "\(standing.wins)-\(standing.losses)"
            let words = standing.ties > 0 ? "\(record)-\(standing.ties)" : record
            return "\(words), \(Formatting.ordinal(standing.place)) of \(standing.teams)"
        } ?? ""
    }
}

/// builder.ts and TradeBuilder.svelte's reads.
enum TradeBuilder {
    static let maxASide = 2
    static let traded: Set = ["QB", "RB", "WR", "TE"]

    /// builder.ts pickable: at QB, RB, WR or TE, named by the platform, not on injured reserve.
    static func pickable(_ line: PlayerLine) -> Bool {
        traded.contains(line.player.position) && !line.player.hostId.isEmpty && !StartRows.onReserve(line)
    }

    /// builder.ts teamChoice: "Muttdogs, muttdog, 5-0".
    static func choice(_ team: TradeTeam) -> String {
        "\(team.name), \(aside(team))"
    }

    /// words.ts teamAside: its owner and its record, the record alone where the team is named for him.
    static func aside(_ team: TradeTeam) -> String {
        let record = team.record
        let base = "\(record.wins)-\(record.losses)"
        let words = record.ties > 0 ? "\(base)-\(record.ties)" : base
        let owner = team.owner.trimmingCharacters(in: .whitespaces)
        let named = owner.isEmpty || owner.lowercased() == team.name.trimmingCharacters(in: .whitespaces).lowercased()
        return named ? words : "\(owner), \(words)"
    }

    /// builder.ts pickPrompt.
    static func prompt(_ picks: TradePicks) -> String {
        switch (picks.give.isEmpty, picks.get.isEmpty) {
        case (false, false): Words.Builder.checking
        case (true, true): Words.Builder.pickBoth
        case (true, false): Words.Builder.pickYours
        case (false, true): Words.Builder.pickTheirs
        }
    }

    /// trades.ts rosterOrder: by position, each by this week's Proj highest first (none after), injured
    /// reserve last, then by name.
    static func rosterOrder(_ lines: [PlayerLine]) -> [PlayerLine] {
        let order = ["QB", "RB", "WR", "TE", "K", "DEF"]
        let place = { (line: PlayerLine) in order.firstIndex(of: line.player.position) ?? order.count }
        let reserve = { (line: PlayerLine) in StartRows.onReserve(line) ? 1 : 0 }
        let proj = { (line: PlayerLine) in line.weekProjection ?? -.infinity }
        return lines.enumerated().sorted { lhs, rhs in
            let left = lhs.element
            let right = rhs.element
            if reserve(left) != reserve(right) {
                return reserve(left) < reserve(right)
            }
            if place(left) != place(right) {
                return place(left) < place(right)
            }
            if proj(left) != proj(right) {
                return proj(left) > proj(right)
            }
            let names = left.player.name.compare(right.player.name, locale: Locale(identifier: "en_US"))
            return names == .orderedSame ? lhs.offset < rhs.offset : names == .orderedAscending
        }.map(\.element)
    }

    /// The builder at its picks and its answer, as TradeBuilder draws it.
    static func model(_ inputs: Inputs) -> TradeBuilderModel {
        let picks = inputs.picks
        let team = inputs.advice.teams.first { $0.rosterId == picks.team }
        let check = inputs.answer.map { TradeChecks.held($0, now: inputs.now) }
        let trade = check?.trade.value1
        let dropID = trade?.drop?.value1.player.hostId
        let room = check.map(TradeChecks.room) ?? (yours: "", theirs: "")
        let sentence = inputs.problem ?? check.map(TradeChecks.words) ?? prompt(picks)
        let box = { (side: TradePicks.Side, lines: [PlayerLine], name: String, mine: Bool, aside: String) in
            BuilderBox(
                team: name, initials: Initials.of(name), mine: mine, aside: aside, holds: holds(picks, side),
                rows: rosterOrder(lines).map { line in
                    row(line, tick: tick(line, side: side, picks: picks, dropID: dropID), inputs: inputs)
                }
            )
        }
        return TradeBuilderModel(
            teams: inputs.advice.teams.map { .init(id: $0.rosterId, choice: choice($0)) },
            team: picks.team,
            bug: TradeBug(
                yours: TradeBugSide(
                    me: true, name: inputs.me.name, totals: check?.totals.yours, gain: trade?.myGain,
                    projChange: trade?.myProjChange, room: room.yours, rest: TradeRest.of(check, mine: true)
                ),
                theirs: TradeBugSide(
                    me: false, name: team?.name ?? "", totals: check?.totals.theirs, gain: trade?.theirGain,
                    projChange: trade?.theirProjChange, room: room.theirs,
                    rest: TradeRest.of(check, mine: false)
                )
            ),
            sentence: sentence,
            quiet: check == nil && inputs.problem == nil,
            close: check.flatMap(closeCall),
            own: check?.basis ?? inputs.advice.checkBasis,
            yours: box(.give, inputs.advice.roster, inputs.me.name, true, inputs.me.aside),
            theirs: team.map { box(.get, $0.roster, $0.name, false, aside($0)) },
            pin: pin(check: check, sentence: sentence),
            verbEnabled: inputs.pageKnown && check != nil
        )
    }

    /// The pin's line: why a side would not take it (TradeBuilder.svelte's refusal, Lane 277), else the
    /// two gains a week, else the answer line.
    static func pin(check: TradeCheck?, sentence: String) -> TradeBuilderModel.Pin {
        if let check, TradeChecks.fillsBoth(check), let refusal = TradeChecks.refusal(check) {
            return .words(refusal)
        }
        guard let trade = check?.trade.value1 else {
            return .words(sentence)
        }
        return .gains(
            mine: TradesWords.gain(trade.myGain),
            rest: "\(Words.Trades.aWeekForYou), \(TradesWords.gain(trade.theirGain)) \(Words.Trades.forTheirs)"
        )
    }

    struct Inputs {
        let advice: TradeAdvice
        let picks: TradePicks
        let answer: TradeCheck?
        let problem: String?
        let me: TradeMe
        let pageKnown: Bool
        let zone: TimeZone
        let now: Date
    }

    /// TradeBuilder's close: a trade both rosters take that the member gains from, a close call for them.
    static func closeCall(_ check: TradeCheck) -> String? {
        let fills = check.fills
        let trade = check.trade.value1
        guard fills.yours, fills.theirs, fills.yoursRoom, fills.theirsRoom, trade.myGain > 0,
              trade.closeForThem, trade.theirGain > 0
        else {
            return nil
        }
        return Words.TradePicker.closeForThem
    }

    /// TradeBuilder's holdsWords: "You give 1", or the full side's words.
    static func holds(_ picks: TradePicks, _ side: TradePicks.Side) -> String {
        let count = picks.players(side).count
        guard count < maxASide else {
            return Words.Builder.full
        }
        return "\(side == .give ? Words.Builder.give : Words.Builder.get) \(count)"
    }

    /// TradeBuilder's tickOf.
    static func tick(_ line: PlayerLine, side: TradePicks.Side, picks: TradePicks, dropID: String?) -> PickTick {
        let id = line.player.hostId
        if side == .give, id == dropID {
            return .drop
        }
        guard pickable(line) else {
            return PickTick.none
        }
        let list = picks.players(side)
        return list.contains(id) ? .picked : .open(disabled: list.count >= maxASide)
    }

    static func row(_ line: PlayerLine, tick: PickTick, inputs: Inputs) -> BuilderRow {
        let cells = RowCells(
            nil, row: StartRows.row(line, slot: "", zone: inputs.zone, now: inputs.now, ranked: false), reserve: nil
        )
        let words = "\(Words.Box.avg) \(StartWords.number(cells.row.avg)), "
            + "\(Words.Box.last) \(StartWords.number(cells.row.last))"
        return BuilderRow(cells: cells, line: words, tick: tick)
    }

    /// The opening picks for Build a trade: the first team with a trade found, else the first team.
    static func opening(_ advice: TradeAdvice) -> TradePicks {
        let first = advice.teams.first { !$0.trades.isEmpty } ?? advice.teams.first
        return TradePicks(team: first?.rosterId, give: [], get: [])
    }

    /// builder.ts builtFrom: a finder row as picks, nil when a player in it has no host id.
    static func built(team: Int, row: TradeRow) -> TradePicks? {
        let give = row.give.map(\.player.hostId)
        let get = row.get.map(\.player.hostId)
        guard !(give + get).contains(where: \.isEmpty) else {
            return nil
        }
        return TradePicks(team: team, give: give, get: get)
    }
}

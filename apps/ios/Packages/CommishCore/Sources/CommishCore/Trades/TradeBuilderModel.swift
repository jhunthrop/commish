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

    /// builder.ts samePicks: the same trade in any order of ticks, so the idea the ticks hold is pressed.
    func same(_ other: TradePicks) -> Bool {
        let same = { (lhs: [String], rhs: [String]) in lhs.count == rhs.count && lhs.allSatisfy(rhs.contains) }
        return team == other.team && same(give, other.give) && same(get, other.get)
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

/// One roster row of the builder (TradeBox's tight BoxLine at 390): the box's cells and his tick.
public struct BuilderRow: Equatable, Sendable, Identifiable {
    public let cells: RowCells
    public let tick: PickTick

    public var id: String {
        cells.id
    }
}

/// One roster as the builder's box draws it: the team, "You" on the member's, its standing, what the
/// side holds, its rows in the builder's order. Their box before a team is chosen has no team and no
/// rows, its head the team choice alone.
public struct BuilderBox: Equatable, Sendable {
    public let team: String
    public let initials: String
    public let mine: Bool
    public let aside: String
    public let holds: String
    public let rows: [BuilderRow]
}

/// The roster switch where the rosters stack (TradeBuilder's .switch): "You, 1" and "Max_Jensen10, 2",
/// "Pick a team" before one is chosen.
public struct RosterSwitch: Equatable, Sendable {
    public let yours: String
    public let theirs: String
}

/// The builder as the screen (TradeBuilder.svelte at 390, Lanes 260, 268, 277): our ideas row, the
/// roster switch, the member's roster or theirs with the team chosen at its head, the verdict (one
/// box-score row per side) with the answer line, the close call's chip and the builder's own lines, and
/// the pin with the gains, Share and the verb.
public struct TradeBuilderModel: Equatable, Sendable {
    public struct TeamChoice: Equatable, Sendable, Identifiable {
        public let id: Int
        public let choice: String
    }

    public let ideas: [IdeaPlace]
    public let ideasHead: String
    /// "8 more", nil once every idea shows.
    public let more: String?
    /// The idea the ticks hold, pressed.
    public let pressed: String?
    public let rosters: RosterSwitch
    public let teams: [TeamChoice]
    public let team: Int?
    /// The team choice as its box shows it: "Max_Jensen10, Max Jensen, 3-2", or "Pick a team".
    public let teamLabel: String
    public let bug: TradeBug
    public let sentence: String
    /// The answer line is the prompt, not an answer: drawn quieter.
    public let quiet: Bool
    public let close: String?
    /// The platform's reason the verb cannot propose from here, or its note when it has no page.
    public let hostLine: String?
    public let own: String
    public let yours: BuilderBox
    public let theirs: BuilderBox
    /// "+5.3 a week for your lineup, +1.1 for theirs" once answered on a trade both rosters can make,
    /// its first figure strong; who would not take it; else the answer line.
    public let pin: Pin
    /// Propose and Share act on the answer only for the team and ticks it was read for, on a trade both
    /// rosters can make (builder.ts proposable).
    public let live: Bool
    public let verbEnabled: Bool

    public enum Pin: Equatable, Sendable {
        case gains(mine: String, rest: String)
        case words(String)
    }

    /// Every player both rosters show in the sheet.
    public var sheetPlayers: [SheetPlayer] {
        (yours.rows + theirs.rows).compactMap(\.cells.sheetPlayer)
    }
}

/// builder.ts and TradeBuilder.svelte's reads.
enum TradeBuilder {
    static let maxASide = 2
    static let traded: Set = ["QB", "RB", "WR", "TE"]
    /// builder.ts BAR_FLOOR: the least a full bar stands for, in points a week.
    static let barFloor = 1.0

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

    /// builder.ts countWords: ", 1" after a side's name on the switch, nothing while none is ticked.
    static func count(_ side: [String]) -> String {
        side.isEmpty ? "" : ", \(side.count)"
    }

    /// builder.ts gainBars: each side's gain as a share of the longer one (at least the floor), 0 to 1.
    static func bars(_ mine: Double?, _ theirs: Double?) -> (yours: Double, theirs: Double) {
        let yours = abs(mine ?? 0)
        let their = abs(theirs ?? 0)
        let full = max(yours, their, barFloor)
        return (yours / full, their / full)
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

    struct Inputs {
        let advice: TradeAdvice
        let ideas: TradeIdeas
        /// Whether the ideas row shows every idea.
        let allIdeas: Bool
        let picks: TradePicks
        /// The last answer and the picks it was read for.
        let answer: TradeCheck?
        let answered: TradePicks?
        let problem: String?
        let me: TradeMe
        let pageKnown: Bool
        let zone: TimeZone
        let now: Date
    }

    /// The builder at its picks and its answer, as TradeBuilder draws it.
    static func model(_ inputs: Inputs) -> TradeBuilderModel {
        let picks = inputs.picks
        let team = inputs.advice.teams.first { $0.rosterId == picks.team }
        let check = inputs.answer.map { TradeChecks.held($0, now: inputs.now) }
        let sentence = inputs.problem ?? (team == nil
            ? Words.Analyzer.noTeam : check.map(TradeChecks.words) ?? prompt(picks))
        let live = team != nil && check.map(TradeChecks.fillsBoth) == true
            && inputs.answered.map(picks.same) == true
        let boxed = boxes(inputs, team: team, check: check)
        return TradeBuilderModel(
            ideas: inputs.ideas.visible(all: inputs.allIdeas),
            ideasHead: inputs.ideas.head,
            more: inputs.ideas.more(all: inputs.allIdeas),
            pressed: inputs.ideas.places.compactMap { place -> String? in
                guard case let .idea(preset) = place, preset.picks.same(picks) else {
                    return nil
                }
                return preset.id
            }.first,
            rosters: RosterSwitch(
                yours: "\(Words.Analyzer.you)\(count(picks.give))",
                theirs: "\(team?.name ?? Words.Analyzer.pickTeam)\(count(picks.get))"
            ),
            teams: inputs.advice.teams.map { .init(id: $0.rosterId, choice: choice($0)) },
            team: picks.team,
            teamLabel: team.map(choice) ?? Words.Analyzer.pickTeam,
            bug: bug(check, me: inputs.me.name, team: team?.name ?? ""),
            sentence: sentence,
            quiet: check == nil && inputs.problem == nil,
            close: check.flatMap(closeCall),
            hostLine: inputs.advice.moves.reason ?? inputs.advice.hostNote,
            own: check?.basis ?? inputs.advice.checkBasis,
            yours: boxed.yours,
            theirs: boxed.theirs,
            pin: pin(check: check, sentence: sentence),
            live: live,
            verbEnabled: live && inputs.pageKnown
        )
    }

    /// The verdict's two rows (TradeBug over bugFigures, checkRoom, gainBars and restFigure).
    static func bug(_ check: TradeCheck?, me: String, team: String) -> TradeBug {
        let trade = check?.trade.value1
        let room = check.map(TradeChecks.room) ?? (yours: "", theirs: "")
        let bars = bars(trade?.myGain, trade?.theirGain)
        return TradeBug(
            yours: TradeBugSide(
                me: true, name: me, totals: check?.totals.yours, gain: trade?.myGain,
                projChange: trade?.myProjChange, room: room.yours, rest: TradeRest.of(check, mine: true),
                bar: bars.yours
            ),
            theirs: TradeBugSide(
                me: false, name: team, totals: check?.totals.theirs, gain: trade?.theirGain,
                projChange: trade?.theirProjChange, room: room.theirs, rest: TradeRest.of(check, mine: false),
                bar: bars.theirs
            )
        )
    }

    /// Both rosters as their boxes draw them: the member's, and theirs (empty before a team is chosen).
    static func boxes(
        _ inputs: Inputs, team: TradeTeam?, check: TradeCheck?
    ) -> (yours: BuilderBox, theirs: BuilderBox) {
        let picks = inputs.picks
        let dropID = check?.trade.value1.drop?.value1.player.hostId
        let rows = { (side: TradePicks.Side, lines: [PlayerLine]) in
            rosterOrder(lines).map { line in
                row(line, tick: tick(line, side: side, picks: picks, dropID: dropID), inputs: inputs)
            }
        }
        let yours = BuilderBox(
            team: inputs.me.name, initials: Initials.of(inputs.me.name), mine: true, aside: inputs.me.aside,
            holds: holds(picks, .give), rows: rows(.give, inputs.advice.roster)
        )
        let theirs = BuilderBox(
            team: team?.name ?? "", initials: team.map { Initials.of($0.name) } ?? "", mine: false,
            aside: team.map(aside) ?? "", holds: team == nil ? "" : holds(picks, .get),
            rows: rows(.get, team?.roster ?? [])
        )
        return (yours, theirs)
    }

    /// The pin's line (TradeBuilder.svelte's .pin-gains): why a side would not take it (Lane 277), else
    /// the two gains a week on a trade both rosters can make, else the answer line.
    static func pin(check: TradeCheck?, sentence: String) -> TradeBuilderModel.Pin {
        guard let check, TradeChecks.fillsBoth(check) else {
            return .words(sentence)
        }
        if let refusal = TradeChecks.refusal(check) {
            return .words(refusal)
        }
        let trade = check.trade.value1
        return .gains(
            mine: TradesWords.gain(trade.myGain),
            rest: "\(Words.Trades.aWeekForYou), \(TradesWords.gain(trade.theirGain)) \(Words.Trades.forTheirs)"
        )
    }

    /// TradeBuilder's close: a trade both rosters take that the member gains from, a close call for them.
    static func closeCall(_ check: TradeCheck) -> String? {
        let trade = check.trade.value1
        guard TradeChecks.fillsBoth(check), trade.myGain > 0, trade.closeForThem, trade.theirGain > 0 else {
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
        return BuilderRow(cells: cells, tick: tick)
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

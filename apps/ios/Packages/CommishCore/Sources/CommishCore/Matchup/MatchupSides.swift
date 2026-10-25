import CommishAPI
import CommishDesign
import Foundation

/// A side's rows and totals as its box draws them (matchup.ts SideBox).
struct SideBox: Equatable {
    let starters: [StartRow]
    let bench: [StartRow]
    let totals: LineupTotals
    /// Every line the side's rows came from, for the basis.
    let lines: [PlayerLine]
    let byPlayer: Bool
    let teamTotal: Bool
}

/// What a side's box reads besides its rows (matchup.ts SideRead).
struct SideRead {
    /// The platform's total for the side as the screen shows it, nil before it has started.
    let hostTotal: Double?
    /// The week's projection has landed.
    let landed: Bool
    let week: Int
    let now: Date
    /// The game has kicked off: the Team row's Pts are its big figure.
    let started: Bool
    /// The bug's head is Final by the lines the screen holds.
    let headFinal: Bool
}

/// A set of games as one read (kickoff.ts GameRead): its state and the earliest kickoff still to come.
struct GamesRead: Equatable {
    let state: GameHeadState
    let next: Date?
}

/// matchup.ts, ported over the API's answers: each side's box, the game's head by its starters' lines
/// (each line's `game_state` read, never computed), the bug's figures and the opponent's best lineup.
enum MatchupSides {
    typealias Known = Components.Schemas.GameStateKnown

    /// kickoff.ts linesRead: final once every game is, under way once any has kicked off, the earliest
    /// kickoff still to come next; each line's game by its field (LineRead).
    static func linesRead(_ lines: [PlayerLine], now: Date) -> GamesRead {
        let states = lines.compactMap { line -> (read: GameRead, kickoff: Date)? in
            guard let kickoff = line.facts.kickoff else {
                return nil
            }
            let read = LineRead.game(line, now: now)
            return [.upcoming, .kickedOff, .final].contains(read) ? (read, kickoff) : nil
        }
        let ahead = states.filter { $0.read == .upcoming }.map(\.kickoff).sorted()
        let state: GameHeadState = if !states.isEmpty, states.allSatisfy({ $0.read == .final }) {
            .final
        } else {
            ahead.count < states.count ? .kickedOff : .upcoming
        }
        return GamesRead(state: state, next: ahead.first)
    }

    /// matchup.ts matchupRead: the starters with a game as one read, never final while a side the
    /// platform lists no starters for is not final by the schedule; nil when no starter has a game.
    static func matchupRead(_ lines: [PlayerLine], now: Date, unlisted: [Known] = []) -> GamesRead? {
        let games = lines.filter { !$0.facts.bye && $0.facts.kickoff != nil }
        guard !games.isEmpty else {
            return nil
        }
        let read = linesRead(games, now: now)
        let waiting = read.state == .final && unlisted.contains { $0 != .final }
        return waiting ? GamesRead(state: .kickedOff, next: read.next) : read
    }

    static func head(_ read: GamesRead, now: Date) -> GameHead {
        GameHead(read: read.state, next: read.next, now: now)
    }

    /// matchup.ts matchupStarted: any starter's game past its kickoff.
    static func started(_ lines: [PlayerLine], now: Date) -> Bool {
        matchupRead(lines, now: now).map { head($0, now: now).state != .upcoming } ?? false
    }

    /// matchup.ts matchupFinal.
    static func final(_ lines: [PlayerLine], now: Date, unlisted: [Known]) -> Bool {
        matchupRead(lines, now: now, unlisted: unlisted)?.state == .final
    }

    /// matchup.ts unlistedStates: the schedule's state of each side listing no starters.
    static func unlistedStates(_ box: MatchupBox?) -> [Known] {
        (box?.sides ?? []).compactMap { $0.scheduleState?.value1.value1 }
    }

    /// matchup.ts nextKickoff: "First kickoff" before any starter's game, "Next kickoff" once one has
    /// started with another to come, then "Kicked off" and "Final"; nil when no starter has a game.
    static func nextKickoff(
        _ lines: [PlayerLine], now: Date, zone: TimeZone, unlisted: [Known]
    ) -> (head: String, words: String)? {
        let games = lines.filter { !$0.facts.bye && $0.facts.kickoff != nil && $0.facts.opponent != nil }
        guard !games.isEmpty, let read = matchupRead(lines, now: now, unlisted: unlisted) else {
            return nil
        }
        let gameHead = head(read, now: now)
        if gameHead.state == .final {
            return (Words.Kickoff.final, "")
        }
        guard let next = games.first(where: { $0.facts.kickoff == gameHead.next }),
              let kickoff = next.facts.kickoff
        else {
            return gameHead.state == .kickedOff ? (Words.Kickoff.kickedOff, "") : nil
        }
        let side = next.facts.home == false ? "at" : "vs"
        let game = "\(next.player.team) \(side) \(next.facts.opponent ?? "")"
        let words = "\(Formatting.weekdayTime(kickoff, zone: zone)), \(game)"
        return (gameHead.state == .kickedOff ? Words.Kickoff.next : Words.Kickoff.first, words)
    }

    /// matchup.ts decidedHead: "Decided" in place of the state while the game plays and the API says so.
    static func decided(
        _ kickoff: (head: String, words: String)?, decided: Bool, started: Bool
    ) -> (head: String, words: String)? {
        guard let kickoff, decided, started, kickoff.head != Words.Kickoff.final else {
            return kickoff
        }
        return (Words.Kickoff.decided, "")
    }

    /// matchup.ts sideBox: the API's rows when it answered for the side, else the league read's
    /// starters with their points so far when the platform gives them.
    static func sideBox(
        _ side: Components.Schemas.MatchupSide, box: MatchupBoxSide?, read: SideRead, zone: TimeZone
    ) -> SideBox {
        guard let box else {
            return hostSide(side, read: read, zone: zone)
        }
        let starters = box.starters.map { starter in
            StartRows.row(starter.line, slot: slotWord(starter.slot), zone: zone, now: read.now)
        }
        let allFinal = box.starters.isEmpty
            ? unlistedFinal(box, read: read)
            : LineRead.setState(box.starters.map(\.line), now: read.now) == .final
        return SideBox(
            starters: starters,
            bench: box.bench.map { StartRows.row($0, slot: "", zone: zone, now: read.now) },
            totals: LineupTotals(
                proj: sideProj(box, rows: starters),
                pts: score(starters, byPlayer: box.playerPoints, teamTotal: box.teamTotal, hostTotal: read.hostTotal),
                final: box.projectedFinal,
                live: read.started,
                allFinal: allFinal,
                note: LineupBoxes.totalsNote(starters, landed: read.landed, week: read.week)
            ),
            lines: box.starters.map(\.line) + box.bench,
            byPlayer: box.playerPoints,
            teamTotal: box.teamTotal
        )
    }

    /// The league read's side alone: its starters by position, their points where the platform gives
    /// each player's, no Proj; Final as the bug's head says it.
    private static func hostSide(_ side: Components.Schemas.MatchupSide, read: SideRead, zone: TimeZone) -> SideBox {
        let starters = side.starters.map { starter in
            hostRow(starter.player, pts: side.playerPoints ? starter.points : nil, zone: zone)
        }
        return SideBox(
            starters: starters,
            bench: [],
            totals: LineupTotals(
                proj: nil,
                pts: score(starters, byPlayer: side.playerPoints, teamTotal: side.teamTotal, hostTotal: read.hostTotal),
                final: nil,
                live: read.started,
                allFinal: read.headFinal,
                note: nil
            ),
            lines: [],
            byPlayer: side.playerPoints,
            teamTotal: side.teamTotal
        )
    }

    /// box.ts hostRow: a player the box has no line for, his name, club and position, and his points.
    static func hostRow(_ player: Components.Schemas.LeaguePlayer, pts: Double?, zone: TimeZone) -> StartRow {
        let mark = player.position == "DEF" && !player.team.isEmpty
        let position = StartRows.positionWord(player.position)
        return StartRow(
            id: player.hostId, boardID: player.boardId, slot: position, name: player.name,
            fit: mark ? StartRows.lastName(StartRows.withoutDefense(player.name)) : StartRows.initialName(player.name),
            slug: nil, clubMark: mark, club: player.team, position: position, rank: nil,
            status: RowStatuses.of(nil, hostIR: player.injuredReserve, zone: zone),
            reserve: player.injuredReserve, game: .none, expected: nil, weather: nil, proj: nil, pts: pts,
            read: .noGame, oppRank: nil, oppOf: nil, avg: nil, last: nil, delta: nil, season: nil
        )
    }

    /// box.ts slotWord over a box starter's slot.
    static func slotWord(_ slot: Components.Schemas.BoxStarter.SlotPayload) -> String {
        LineupBoxes.slotWord(slot.value1?.rawValue ?? slot.value2 ?? "")
    }

    /// matchup.ts sideScore: the platform's own total where it sends one or gives no player's points,
    /// else the printed rows added.
    static func score(_ rows: [StartRow], byPlayer: Bool, teamTotal: Bool, hostTotal: Double?) -> Double? {
        byPlayer && !teamTotal ? LineupBoxes.printedSum(rows.map(\.pts)) : hostTotal
    }

    /// matchup.ts sideProj: the starters' rows added, or our best lineup's figure for a side listing none.
    static func sideProj(_ box: MatchupBoxSide, rows: [StartRow]) -> Double? {
        guard box.starters.isEmpty, box.projectionBestLineup == true else {
            return LineupBoxes.printedSum(rows.map(\.proj))
        }
        return box.projection
    }

    /// matchup.ts unlistedFinal: a side listing no starters is Final by the schedule's state, an answer
    /// without it by the bug's head.
    static func unlistedFinal(_ box: MatchupBoxSide, read: SideRead) -> Bool {
        guard let state = box.scheduleState?.value1 else {
            return read.headFinal
        }
        return state.value1 == .final
    }

    /// matchup.ts matchupUnlisted: what an opponent the platform lists no starters for draws from our
    /// best lineup of his roster, said once in the basis.
    static func unlisted(_ box: MatchupBoxSide?, totals: LineupTotals) -> UnlistedDrawn {
        guard let box, box.starters.isEmpty, !(totals.live && totals.allFinal) else {
            return UnlistedDrawn()
        }
        let figure = totals.live ? totals.final : totals.proj
        guard box.projectionBestLineup == true else {
            return figure == nil ? UnlistedDrawn(noRoster: true) : UnlistedDrawn()
        }
        guard figure != nil else {
            return UnlistedDrawn()
        }
        return UnlistedDrawn(
            bestLineup: true, paced: totals.live && box.projectedFinalPaced == true,
            skipped: box.bestLineupSkipped == true
        )
    }

    /// matchup.ts matchupNoFinal: a Team row under way draws its Proj final "--" the key explains.
    static func noFinal(mine: LineupTotals, theirs: LineupTotals?, theirsUnlisted: UnlistedDrawn) -> Bool {
        let missing = { (totals: LineupTotals?) in totals.map { $0.live && $0.final == nil } ?? false }
        return missing(mine) || (missing(theirs) && !theirsUnlisted.noRoster)
    }

    /// matchup.ts bugFigures: before kickoff the Proj big and nothing under; from it the Pts big with
    /// the Team row's small figure under ("Proj final 73.2", "Final 63.5").
    static func bugFigures(_ totals: LineupTotals, started: Bool) -> BugFigures {
        let live = LineupTotals(
            proj: totals.proj, pts: totals.pts, final: totals.final, live: started, allFinal: totals.allFinal,
            note: totals.note
        )
        guard let small = StartWords.teamSmall(live) else {
            return BugFigures(big: StartWords.number(totals.proj), label: Words.Box.proj, small: "")
        }
        let under = "\(small.caption) \(StartWords.number(small.figure))"
        return BugFigures(big: StartWords.number(totals.pts), label: Words.Box.pts, small: under)
    }
}

/// A side's two figures as the bug prints them (matchup.ts bugFigures): the big one, its label, the
/// small one under.
struct BugFigures: Equatable {
    let big: String
    let label: String
    let small: String
}

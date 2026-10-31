import CommishAPI
import CommishDesign
import Foundation

/// One side of the Matchup's score bug (MatchupBug.svelte): You or Opponent (neither on another team's
/// game, Lane 206), the team, its big figure
/// with its label (Proj before the first kickoff, Pts from it), the small one under, and where its
/// starters stand while the game is under way.
public struct BugTeam: Equatable, Sendable {
    public let label: String
    public let name: String
    public let initials: String
    public let me: Bool
    public let big: String
    public let bigLabel: String
    public let small: String
    public let toPlay: String
}

/// The Matchup's score bug: the week, the game's head and its words ("Next kickoff", "Sun 3:05 pm, ARI
/// at LAR"), the read beside a live score, both teams and the API's line on where the member stands.
public struct MatchupBug: Equatable, Sendable {
    public let week: String
    public let mine: BugTeam
    public let opponent: BugTeam?
    public let head: String?
    public let words: String
    /// "FFPC 4 min ago" beside a live score; nil before kickoff and once final.
    public let read: String?
    public let standing: String?
    public let started: Bool
}

/// One team's box (BoxTable.svelte at 390): its name, its starters in the platform's slots, the Team
/// row lit like the bug, its bench; the sentence in place of starters the platform does not send.
public struct TeamBox: Equatable, Sendable, Identifiable {
    public let id: Int
    public let team: String
    public let initials: String
    public let mine: Bool
    public let empty: String?
    public let starters: [RowCells]
    public let teamRow: TeamRow
    public let bench: [RowCells]
}

/// The week's matchup as the screen draws it.
public struct MatchupWeek: Equatable, Sendable {
    /// "Their game" with the way to the member's own, over another team's game; nil over the member's.
    public let whose: GameWhose?
    public let week: String
    public let mine: String
    public let opponent: String?
    public let bug: MatchupBug
    /// Said under the bug: an all-play week, a score the platform could not give.
    public let notes: [String]
    /// "No opponent this week", where the boxes' second would be.
    public let noOpponent: String?
    public let boxes: [TeamBox]
    public let basis: String

    /// Whether his row is one of the member's own (MatchupPanel.svelte rowsOf(mine)): only those offer
    /// the way to his lineup.
    public func isMine(_ player: SheetPlayer) -> Bool {
        boxes.filter(\.mine).flatMap { $0.starters + $0.bench }.contains { $0.sheetPlayer?.id == player.id }
    }

    /// Every player a row opens in the sheet, both teams'.
    public var sheetPlayers: [SheetPlayer] {
        boxes.flatMap { $0.starters + $0.bench }.compactMap(\.sheetPlayer)
    }
}

/// The Matchup screen at one read (MatchupScreen.svelte and MatchupPanel.svelte at 390): this week's
/// game as a box score, or the sentence where the league read holds no game for the member.
public enum MatchupModel: Equatable, Sendable {
    case week(MatchupWeek)
    case gap(String)

    /// The screen drawn at the league read's instant, as the web draws it (MatchupScreen passes the
    /// read's time), the read beside a live score aged by `clock`, the screen's own clock. Another
    /// team's game, by the box's own word, is drawn from the box and the scoreboard (`board`), its
    /// score unread where the scoreboard was not read.
    /// `words` is the platform's words, the league's own unless a store graphic passes the neutral one
    /// (Lane 310).
    public init(
        sync: LeagueSync, box: MatchupBox?, board: Scoreboard? = nil, clock: Date, zone: TimeZone,
        words: HostWords? = nil
    ) {
        let now = sync.readAt
        let other = OtherGame.isOther(box)
        guard let matchup = other ? OtherGame.matchup(box, board: board) : sync.matchup?.value1 else {
            self = .gap(MatchupWords.gap(sync, now: now))
            return
        }
        let draw = MatchupDraw(
            sync: sync, box: box, matchup: matchup, other: other, now: now, zone: zone, words: words ?? .of(sync.host)
        )
        self = .week(draw.week(clock: clock))
    }
}

/// MatchupPanel.svelte's reads over one answer.
private struct MatchupDraw {
    let sync: LeagueSync
    let box: MatchupBox?
    let matchup: Components.Schemas.LeagueMatchup
    /// Another team's game: none of the member's words, marks or verbs.
    let other: Bool
    let now: Date
    let zone: TimeZone
    let words: HostWords
    let started: Bool
    let unlisted: [MatchupSides.Known]
    let headFinal: Bool
    let starterLines: [PlayerLine]

    init(
        sync: LeagueSync, box: MatchupBox?, matchup: Components.Schemas.LeagueMatchup, other: Bool, now: Date,
        zone: TimeZone, words: HostWords
    ) {
        self.words = words
        self.sync = sync
        self.box = box
        self.matchup = matchup
        self.other = other
        self.now = now
        self.zone = zone
        starterLines = (box?.sides ?? []).flatMap { $0.starters.map(\.line) }
        started = MatchupSides.started(starterLines, now: now)
        unlisted = MatchupSides.unlistedStates(box)
        headFinal = MatchupSides.final(starterLines, now: now, unlisted: unlisted)
    }

    func boxSide(_ rosterID: Int) -> MatchupBoxSide? {
        box?.sides.first { $0.rosterId == rosterID }
    }

    /// MatchupPanel's showsTotal: a read score once the side has started, or at 0 in an all-play week.
    func showsTotal(_ side: Components.Schemas.MatchupSide) -> Bool {
        let begun = side.points != 0 || side.starters.contains { ($0.points ?? 0) != 0 }
        return side.pointsRead && (begun || sync.weekAllPlay)
    }

    func side(_ side: Components.Schemas.MatchupSide) -> SideBox {
        MatchupSides.sideBox(side, box: boxSide(side.rosterId), read: SideRead(
            hostTotal: showsTotal(side) ? side.points : nil, landed: box?.projectionReadAt != nil,
            week: matchup.week, now: now, started: started, headFinal: headFinal
        ), zone: zone)
    }

    func week(clock: Date) -> MatchupWeek {
        let mine = side(matchup.mine)
        let opponentSide = matchup.opponent?.value1
        let theirs = opponentSide.map(side)
        let theirsUnlisted = theirs
            .map { MatchupSides.unlisted(boxSide(opponentSide?.rosterId ?? -1), totals: $0.totals) }
            ?? UnlistedDrawn()
        let kickoff = MatchupSides.decided(
            MatchupSides.nextKickoff(starterLines, now: now, zone: zone, unlisted: unlisted),
            decided: box?.decided == true, started: started
        )
        let platform = words.name
        let read = started && kickoff?.head != Words.Kickoff.final
            ? ScoreBugs.readCell(.init(platform: words.stamp, readAt: sync.readAt), now: clock) : nil
        let week = "\(Words.LeagueHome.week) \(matchup.week)"
        let mineName = MatchupWords.teamName(sync, matchup.mine.rosterId)
        let theirName = opponentSide.map { MatchupWords.teamName(sync, $0.rosterId) }
        let sides = [mine] + (theirs.map { [$0] } ?? [])
        let basis = MatchupBasis.phone(.init(
            host: sync.host, projection: box.map { ($0.projectionReadAt, $0.projectionScoring) },
            lines: sides.flatMap(\.lines), byPlayer: mine.byPlayer, teamTotal: mine.teamTotal, kicked: started,
            noFinal: MatchupSides.noFinal(mine: mine.totals, theirs: theirs?.totals, theirsUnlisted: theirsUnlisted),
            allFinal: sides.allSatisfy(\.totals.allFinal),
            finalNone: sides.contains { $0.totals.live && $0.totals.allFinal && $0.totals.pts == nil },
            unlisted: theirsUnlisted, zone: zone, now: now, words: words
        ))
        let hidden = sync.host.value1 == .ffpc ? MatchupWords.yoursOnly(platform) : nil
        var boxes = [teamBox(
            matchup.mine.rosterId, name: mineName, side: mine, mine: !other, empty: other ? hidden : nil
        )]
        if let opponentSide, let theirs, let theirName {
            boxes.append(teamBox(opponentSide.rosterId, name: theirName, side: theirs, mine: false, empty: hidden))
        }
        return MatchupWeek(
            whose: other ? .theirs : nil,
            week: week, mine: mineName, opponent: theirName,
            bug: MatchupBug(
                week: week,
                mine: bugTeam(matchup.mine.rosterId, name: mineName, side: mine, me: !other),
                opponent: opponentSide.flatMap { side in
                    theirs.map { bugTeam(side.rosterId, name: theirName ?? "", side: $0, me: false) }
                },
                head: kickoff?.head, words: kickoff?.words ?? "", read: read,
                standing: started ? box?.standing : nil, started: started
            ),
            notes: notes(platform),
            noOpponent: opponentSide == nil && !sync.weekAllPlay ? Words.Box.noOpponent : nil,
            boxes: boxes,
            basis: basis
        )
    }

    func notes(_ platform: String) -> [String] {
        guard !other else {
            return []
        }
        var notes: [String] = []
        if sync.weekAllPlay {
            notes.append(MatchupWords.allPlay(platform))
        }
        if !matchup.mine.pointsRead {
            notes.append(MatchupWords.scoreGap(sync, now: now))
        }
        return notes
    }

    func bugTeam(_ rosterID: Int, name: String, side: SideBox, me: Bool) -> BugTeam {
        let figures = MatchupSides.bugFigures(side.totals, started: started)
        return BugTeam(
            label: other ? "" : me ? Words.Box.you : Words.Box.opponent,
            name: name, initials: Initials.of(name), me: me,
            big: figures.big, bigLabel: figures.label, small: figures.small,
            toPlay: started ? boxSide(rosterID)?.toPlay ?? "" : ""
        )
    }

    func teamBox(_ rosterID: Int, name: String, side: SideBox, mine: Bool, empty: String?) -> TeamBox {
        let small = StartWords.teamSmall(side.totals)
        return TeamBox(
            id: rosterID, team: name, initials: Initials.of(name), mine: mine,
            empty: side.starters.isEmpty ? empty : nil,
            starters: side.starters.map { RowCells(nil, row: $0, reserve: nil) },
            teamRow: TeamRow(
                note: side.totals.note, live: side.totals.live, caption: small?.caption,
                proj: StartWords.number(small.map(\.figure) ?? side.totals.proj),
                pts: StartWords.number(side.totals.pts)
            ),
            bench: side.bench.map { RowCells(nil, row: $0, reserve: nil) }
        )
    }
}
